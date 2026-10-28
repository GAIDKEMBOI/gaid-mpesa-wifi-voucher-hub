// Customer (prepaid account) server functions for the captive portal.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PACKAGE_IDS, getPackage, normalizeMac, normalizePhone, topUpAmountProblem, topUpShortfall, OTP_LENGTH } from "@/lib/wifi";

const token = z.string().max(600);
const mac = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const m = normalizeMac(v);
    if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid device MAC address" });
    return m ?? "";
  });

export const requestSignInCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ phone: z.string().max(20) }).parse(d))
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false as const, error: "Enter a valid Safaricom number, e.g. 0712345678" };
    const { requestOtp } = await import("@/lib/prepaid.server");
    const r = await requestOtp(phone);
    return r.ok ? { ok: true as const, phone, testCode: r.testCode ?? null } : r;
  });

export const verifySignInCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        phone: z.string().max(20),
        code: z.string().max(10),
        name: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    const code = data.code.replace(/\D/g, "");
    if (!phone || code.length !== OTP_LENGTH) return { ok: false as const, error: `Enter the ${OTP_LENGTH}-digit code` };
    const name = data.name?.trim().replace(/\s+/g, " ").slice(0, 40) || null;
    const { verifyOtp } = await import("@/lib/prepaid.server");
    return verifyOtp(phone, code, name);
  });

export const getMyAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac: mac.nullable() }).parse(d))
  .handler(async ({ data }) => {
    const { requireCustomer, accountOverview } = await import("@/lib/prepaid.server");
    const account = await requireCustomer(data.token);
    return accountOverview(account.phone, data.mac || null);
  });

/** BUY: pays from credit; if credit is short, sends an M-Pesa prompt for the missing amount only. */
export const buyPackage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac, packageId: z.enum(PACKAGE_IDS) }).parse(d))
  .handler(async ({ data }) => {
    const { requireCustomer, buyFromCredit } = await import("@/lib/prepaid.server");
    const { isBlocked } = await import("@/lib/access.server");
    const account = await requireCustomer(data.token);
    const pkg = getPackage(data.packageId)!;
    if (await isBlocked(data.mac)) return { ok: false as const, error: "This device is blocked. Contact the admin." };

    const short = topUpShortfall(pkg.price, account.credit);
    if (short === 0) {
      const r = await buyFromCredit(account.phone, pkg, data.mac);
      if (r.ok) return { ok: true as const, paid: "credit" as const, expiry: r.expiry };
      if (!r.insufficient) return { ok: false as const, error: r.error };
    }
    const { startStkPayment } = await import("@/lib/payments.server");
    const amount = short === 0 ? pkg.price : short; // credit vanished meanwhile: charge the full price
    const r = await startStkPayment({
      phone: account.phone,
      mac: data.mac,
      packageId: pkg.id,
      amount,
      purpose: "topup",
      description: `WiFi ${pkg.label}`,
    });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, paid: "mpesa" as const, transactionId: r.transactionId, amount, mock: r.mock };
  });

export const useDeviceSlot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac, subscriptionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { requireCustomer, useSlot } = await import("@/lib/prepaid.server");
    const account = await requireCustomer(data.token);
    return useSlot(account.phone, data.subscriptionId, data.mac);
  });

export const claimFreeWifiNow = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac }).parse(d))
  .handler(async ({ data }) => {
    const { requireCustomer, claimFreeWifi } = await import("@/lib/prepaid.server");
    const account = await requireCustomer(data.token);
    return claimFreeWifi(account.phone, data.mac);
  });

/** Top up credit by M-Pesa. The money only goes into credit; the customer then taps BUY. */
export const topUpCredit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, amount: z.number(), mac: mac.nullable() }).parse(d))
  .handler(async ({ data }) => {
    const problem = topUpAmountProblem(data.amount);
    if (problem) return { ok: false as const, error: problem };
    const { requireCustomer } = await import("@/lib/prepaid.server");
    const { startStkPayment } = await import("@/lib/payments.server");
    const account = await requireCustomer(data.token);
    const r = await startStkPayment({
      phone: account.phone,
      mac: data.mac || "-",
      packageId: "credit",
      amount: data.amount,
      purpose: "credit",
      description: "WiFi credit",
    });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, transactionId: r.transactionId, amount: data.amount, mock: r.mock };
  });
