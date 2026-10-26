import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { PACKAGE_IDS, getPackage, normalizeMac, normalizePhone, normalizeVoucher } from "@/lib/wifi";
import { activateAccess, db, finalizeFailure, getActiveSession, isBlocked } from "@/lib/access.server";
import { getMpesaConfig, mpesaMode, stkPush } from "@/lib/mpesa.server";
import { refreshPendingTransaction } from "@/lib/payments.server";

const macSchema = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const mac = normalizeMac(v);
    if (!mac) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid device MAC address" });
    return mac ?? "";
  });

export const getPortalInfo = createServerFn({ method: "GET" }).handler(async () => {
  return { mpesaMode: mpesaMode() };
});

export const getAccessStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ mac: macSchema }).parse(d))
  .handler(async ({ data }) => {
    if (await isBlocked(data.mac)) return { online: false, blocked: true, expiry: null, packageId: null };
    const s = await getActiveSession(data.mac);
    return {
      online: Boolean(s),
      blocked: false,
      expiry: s?.expiry ?? null,
      packageId: s?.package ?? null,
    };
  });

export const startPayment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ phone: z.string().max(20), mac: macSchema, packageId: z.enum(PACKAGE_IDS) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false as const, error: "Enter a valid Safaricom number, e.g. 0712345678" };
    const pkg = getPackage(data.packageId)!;
    if (await isBlocked(data.mac)) return { ok: false as const, error: "This device is blocked. Contact the admin." };

    const cfg = getMpesaConfig();
    const callbackToken = crypto.randomUUID();
    const { data: txn, error } = await db
      .from("transactions")
      .insert({
        phone,
        mac: data.mac,
        package: pkg.id,
        amount: pkg.price,
        callback_token: callbackToken,
        is_mock: !cfg,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !txn) {
      console.error(error);
      return { ok: false as const, error: "Could not start payment. Try again." };
    }

    if (cfg) {
      const base = process.env["MPESA_CALLBACK_BASE_URL"] || new URL(getRequest().url).origin;
      try {
        const r = await stkPush(cfg, {
          phone,
          amount: pkg.price,
          callbackUrl: `${base.replace(/\/$/, "")}/api/public/mpesa/callback?t=${callbackToken}`,
          reference: "GAIDWIFI",
          description: `WiFi ${pkg.label}`,
        });
        await db
          .from("transactions")
          .update({ checkout_request_id: r.checkoutRequestId, merchant_request_id: r.merchantRequestId })
          .eq("id", txn.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "M-Pesa request failed";
        await finalizeFailure(txn.id, "failed", msg);
        return { ok: false as const, error: msg };
      }
    }
    return { ok: true as const, transactionId: txn.id, mock: !cfg };
  });

export const checkPayment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ transactionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: txn } = await db.from("transactions").select("*").eq("id", data.transactionId).maybeSingle();
    if (!txn) return { status: "failed" as const, message: "Payment not found", expiry: null };

    await refreshPendingTransaction(txn);

    const { data: fresh } = await db
      .from("transactions")
      .select("status, result_desc, mac")
      .eq("id", txn.id)
      .single();
    const session = fresh?.status === "success" ? await getActiveSession(txn.mac) : null;
    return {
      status: (fresh?.status ?? "failed") as "pending" | "success" | "failed" | "cancelled",
      message: fresh?.result_desc ?? null,
      expiry: session?.expiry ?? null,
    };
  });

export const redeemVoucher = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: z.string().max(20), mac: macSchema }).parse(d))
  .handler(async ({ data }) => {
    const code = normalizeVoucher(data.code);
    if (code.length < 4) return { ok: false as const, error: "Enter your voucher code" };
    if (await isBlocked(data.mac)) return { ok: false as const, error: "This device is blocked. Contact the admin." };
    const { data: v } = await db
      .from("vouchers")
      .update({ used: true, used_by_mac: data.mac, used_at: new Date().toISOString() })
      .eq("code", code)
      .eq("used", false)
      .select("package")
      .maybeSingle();
    if (!v) return { ok: false as const, error: "Invalid or already used voucher" };
    const expiry = await activateAccess({ mac: data.mac, phone: null, packageId: v.package, source: "voucher" });
    return { ok: true as const, expiry: expiry.toISOString() };
  });

