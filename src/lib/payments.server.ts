import { PAYMENT_TIMEOUT_MS } from "@/lib/wifi";
import { db, finalizeFailure, finalizeSuccess } from "@/lib/access.server";
import { getMpesaConfig, stkQuery } from "@/lib/mpesa.server";

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
