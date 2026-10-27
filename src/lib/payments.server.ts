import { PAYMENT_TIMEOUT_MS } from "@/lib/wifi";
import { db, finalizeFailure, finalizeSuccess } from "@/lib/access.server";
import { getRequest } from "@tanstack/react-start/server";
import { getMpesaConfig, stkPush, stkQuery } from "@/lib/mpesa.server";

interface PendingTxn {
  id: string;
  status: string;
  is_mock: boolean;
  checkout_request_id: string | null;
  last_query_at: string | null;
  created_at: string;
}

/**
 * Moves a pending STK push forward: test-mode payments auto-confirm after a short delay,
 * Daraja payments are asked about (at most every 10s), and anything older than the timeout fails.
 * Shared by the customer portal poll and the admin payment panel.
 */
export async function refreshPendingTransaction(txn: PendingTxn): Promise<void> {
  if (txn.status !== "pending") return;
  const age = Date.now() - new Date(txn.created_at).getTime();
  if (txn.is_mock && age > 6000) {
    const code = `SIM${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    await finalizeSuccess(txn.id, code);
    return;
  }
  if (!txn.is_mock && txn.checkout_request_id) {
    const cfg = getMpesaConfig();
    const lastQuery = txn.last_query_at ? new Date(txn.last_query_at).getTime() : 0;
    if (cfg && age > 15000 && Date.now() - lastQuery > 10000) {
      await db.from("transactions").update({ last_query_at: new Date().toISOString() }).eq("id", txn.id);
      try {
        const r = await stkQuery(cfg, txn.checkout_request_id);
        if (r.state === "success") await finalizeSuccess(txn.id, null);
        else if (r.state !== "pending") await finalizeFailure(txn.id, r.state, r.desc);
      } catch (e) {
        console.error("stk query", e);
      }
    }
  }
  if (age > PAYMENT_TIMEOUT_MS) await finalizeFailure(txn.id, "failed", "Payment timed out. Customer did not enter the PIN.");
}

/** Creates the payment record and sends the M-Pesa prompt (or simulates it in test mode). */
export async function startStkPayment(input: {
  phone: string;
  mac: string;
  packageId: string;
  amount: number;
  purpose: "package" | "topup";
  description: string;
}): Promise<{ ok: true; transactionId: string; mock: boolean } | { ok: false; error: string }> {
  const cfg = getMpesaConfig();
  const callbackToken = crypto.randomUUID();
  const { data: txn, error } = await db
    .from("transactions")
    .insert({
      phone: input.phone,
      mac: input.mac,
      package: input.packageId,
      amount: input.amount,
      purpose: input.purpose,
      callback_token: callbackToken,
      is_mock: !cfg,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !txn) {
    console.error(error);
    return { ok: false, error: "Could not start payment. Try again." };
  }
  if (cfg) {
    const base = process.env["MPESA_CALLBACK_BASE_URL"] || new URL(getRequest().url).origin;
    try {
      const r = await stkPush(cfg, {
        phone: input.phone,
        amount: input.amount,
        callbackUrl: `${base.replace(/\/$/, "")}/api/public/mpesa/callback?t=${callbackToken}`,
        reference: "GAIDWIFI",
        description: input.description,
      });
      await db
        .from("transactions")
        .update({ checkout_request_id: r.checkoutRequestId, merchant_request_id: r.merchantRequestId })
        .eq("id", txn.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "M-Pesa request failed";
      await finalizeFailure(txn.id, "failed", msg);
      return { ok: false, error: msg };
    }
  }
  return { ok: true, transactionId: txn.id, mock: !cfg };
}
