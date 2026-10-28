import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PACKAGE_IDS, getPackage, normalizeMac, normalizePhone, normalizeVoucher } from "@/lib/wifi";
import { activateAccess, db, getActiveSession, isBlocked } from "@/lib/access.server";
import { mpesaMode } from "@/lib/mpesa.server";
import { refreshPendingTransaction, startStkPayment } from "@/lib/payments.server";

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

    return startStkPayment({
      phone,
      mac: data.mac,
      packageId: pkg.id,
      amount: pkg.price,
      purpose: "package",
      description: `WiFi ${pkg.label}`,
    });
  });

export const checkPayment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ transactionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: txn } = await db.from("transactions").select("*").eq("id", data.transactionId).maybeSingle();
    if (!txn) return { status: "failed" as const, message: "Payment not found", expiry: null, purpose: "package" };

    await refreshPendingTransaction(txn);

    const { data: fresh } = await db
      .from("transactions")
      .select("status, result_desc, mac, purpose")
      .eq("id", txn.id)
      .single();
    const session = fresh?.status === "success" && fresh.purpose !== "credit" ? await getActiveSession(txn.mac) : null;
    return {
      purpose: fresh?.purpose ?? txn.purpose,
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

