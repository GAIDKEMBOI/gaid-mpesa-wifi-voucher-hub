import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  LOGIN_LOCK_MINUTES,
  MAX_VOUCHERS_PER_BATCH,
  PACKAGE_IDS,
  adminPasswordProblem,
  creditChangeProblem,
  makeVoucherCode,
  normalizeAdminUsername,
  normalizeMac,
  normalizePhone,
  startOfKenyaDay,
} from "@/lib/wifi";
import {
  activateAccess,
  clientIp,
  createAdminToken,
  db,
  disconnectMac,
  getAdminAccount,
  hashPassword,
  loginLocked,
  recordAttempt,
  requireAdmin,
  sweepExpired,
  verifyPassword,
} from "@/lib/access.server";
import { router, routerMode } from "@/lib/mikrotik.server";
import { mpesaMissingKeys, mpesaMode } from "@/lib/mpesa.server";
import { refreshPendingTransaction } from "@/lib/payments.server";

const token = z.string().max(500);
const mac = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const m = normalizeMac(v);
    if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid MAC address" });
    return m ?? "";
  });

const LOCKED_MSG = `Too many wrong tries. Wait ${LOGIN_LOCK_MINUTES} minutes and try again.`;

export const getAdminStatus = createServerFn({ method: "POST" }).handler(async () => {
  const account = await getAdminAccount();
  return { setUp: Boolean(account) };
});

/** First-run setup: whoever opens /admin first creates the only admin account; closed once it exists. */
export const setupAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ username: z.string().max(60), password: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ip = clientIp();
    if (await loginLocked(ip)) return { ok: false as const, error: LOCKED_MSG };
    if (await getAdminAccount()) return { ok: false as const, error: "Admin account already exists. Please log in." };
    const username = normalizeAdminUsername(data.username);
    if (!username) return { ok: false as const, error: "Username: 3-40 letters or numbers, no spaces" };
    const problem = adminPasswordProblem(data.password, username);
    if (problem) return { ok: false as const, error: problem };

    const { error } = await db.from("admin_account").insert({ id: 1, username, ...(await hashPassword(data.password)) });
    if (error) return { ok: false as const, error: "Admin account already exists. Please log in." };
    await recordAttempt(ip, true);
    return { ok: true as const, token: await createAdminToken(1) };
  });

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ username: z.string().max(100), password: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ip = clientIp();
    if (await loginLocked(ip)) return { ok: false as const, error: LOCKED_MSG };
    const account = await getAdminAccount();
    if (!account) return { ok: false as const, error: "Admin account is not set up yet", needsSetup: true };
    const userOk = safeUser(data.username) === account.username;
    const passOk = await verifyPassword(account, data.password);
    if (!userOk || !passOk) {
      await recordAttempt(ip, false);
      return { ok: false as const, error: "Wrong username or password" };
    }
    await recordAttempt(ip, true);
    return { ok: true as const, token: await createAdminToken(account.session_version) };
  });

function safeUser(u: string) {
  return u.trim().toLowerCase();
}

export const changeAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token, currentPassword: z.string().max(200), newPassword: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const account = await requireAdmin(data.token);
    const ip = clientIp();
    if (await loginLocked(ip)) return { ok: false as const, error: LOCKED_MSG };
    if (!(await verifyPassword(account, data.currentPassword))) {
      await recordAttempt(ip, false);
      return { ok: false as const, error: "Current password is wrong" };
    }
    const problem = adminPasswordProblem(data.newPassword, account.username);
    if (problem) return { ok: false as const, error: problem };
    if (data.newPassword === data.currentPassword)
      return { ok: false as const, error: "New password must be different" };
    const version = account.session_version + 1;
    await db
      .from("admin_account")
      .update({ ...(await hashPassword(data.newPassword)), session_version: version, updated_at: new Date().toISOString() })
      .eq("id", 1);
    return { ok: true as const, token: await createAdminToken(version) };
  });

export const getDashboard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    await sweepExpired();
    const nowIso = new Date().toISOString();
    const today = startOfKenyaDay(new Date()).toISOString();

    const [active, paidToday, usersToday, sessions, blocked] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true }).eq("status", "active").gt("expiry", nowIso),
      db.from("transactions").select("amount").eq("status", "success").gte("created_at", today),
      db.from("users").select("mac").gte("created_at", today),
      db.from("users").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("blocked_macs").select("*").order("created_at", { ascending: false }),
    ]);

    return {
      activeNow: active.count ?? 0,
      collectionToday: (paidToday.data ?? []).reduce((s, t) => s + t.amount, 0),
      usersToday: new Set((usersToday.data ?? []).map((u) => u.mac)).size,
      sessions: sessions.data ?? [],
      blocked: blocked.data ?? [],
      mpesaMode: mpesaMode(),
      mpesaMissing: mpesaMissingKeys(),
      mpesaTill: process.env["MPESA_TILL_NUMBER"]?.trim() || null,
      routerMode: routerMode(),
    };
  });

const TXN_COLUMNS =
  "id, phone, mac, package, amount, purpose, mpesa_code, status, result_desc, is_mock, checkout_request_id, last_query_at, created_at, updated_at";

/** STK pushes with their payment state and what each one did for the customer's internet. */
export const listTransactions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const load = async () =>
      (await db.from("transactions").select(TXN_COLUMNS).order("created_at", { ascending: false }).limit(300)).data ?? [];
    let rows = await load();

    // Move waiting payments forward (Daraja status check / timeout) so the panel never shows stale "pending".
    const pending = rows.filter((r) => r.status === "pending").slice(0, 10);
    if (pending.length) {
      await Promise.all(pending.map((t) => refreshPendingTransaction(t).catch((e) => console.error(e))));
      rows = await load();
    }

    const paidMacs = [...new Set(rows.filter((r) => r.status === "success").map((r) => r.mac))];
    const { data: grants } = paidMacs.length
      ? await db.from("users").select("mac, expiry, status").in("mac", paidMacs)
      : { data: [] as { mac: string; expiry: string; status: string }[] };
    const nowMs = Date.now();

    return rows.map((t) => {
      let accessUntil: string | null = null;
      let stillActive = false;
      if (t.status === "success") {
        // Access granted by this payment = latest expiry for this device set at/after the payment confirmed.
        const paidAt = new Date(t.updated_at).getTime();
        for (const g of grants ?? []) {
          if (g.mac !== t.mac) continue;
          const exp = new Date(g.expiry).getTime();
          if (exp <= paidAt) continue;
          if (!accessUntil || exp > new Date(accessUntil).getTime()) {
            accessUntil = g.expiry;
            stillActive = g.status === "active" && exp > nowMs;
          }
        }
      }
      return {
        id: t.id,
        phone: t.phone,
        mac: t.mac,
        package: t.package,
        amount: t.amount,
        purpose: t.purpose,
        mpesa_code: t.mpesa_code,
        status: t.status,
        result_desc: t.result_desc,
        is_mock: t.is_mock,
        stkSent: Boolean(t.checkout_request_id) || t.is_mock,
        created_at: t.created_at,
        updated_at: t.updated_at,
        accessUntil,
        stillActive,
      };
    });
  });

export const listVouchers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const { data: rows } = await db
      .from("vouchers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    return rows ?? [];
  });

export const disconnectUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    await disconnectMac(data.mac);
    await router.removeMac(data.mac);
    return { ok: true };
  });

export const addUserManual = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ token, mac, phone: z.string().max(20).optional(), packageId: z.enum(PACKAGE_IDS) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const phone = data.phone ? normalizePhone(data.phone) : null;
    if (data.phone && !phone) return { ok: false as const, error: "Invalid phone number" };
    await db.from("blocked_macs").delete().eq("mac", data.mac);
    const expiry = await activateAccess({ mac: data.mac, phone, packageId: data.packageId, source: "manual" });
    return { ok: true as const, expiry: expiry.toISOString() };
  });

export const generateVouchers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token,
        packageId: z.enum(PACKAGE_IDS),
        count: z.number().int().min(1).max(MAX_VOUCHERS_PER_BATCH),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const batch = `B${Date.now().toString(36).toUpperCase()}`;
    const codes = new Set<string>();
    while (codes.size < data.count) {
      codes.add(makeVoucherCode(crypto.getRandomValues(new Uint8Array(8))));
    }
    const rows = [...codes].map((code) => ({ code, package: data.packageId, batch }));
    const { error } = await db.from("vouchers").upsert(rows, { onConflict: "code", ignoreDuplicates: true });
    if (error) {
      console.error(error);
      return { ok: false as const, error: "Could not create vouchers" };
    }
    return { ok: true as const, batch, codes: [...codes] };
  });

export const blockMac = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac, reason: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    await db.from("blocked_macs").upsert({ mac: data.mac, reason: data.reason || null });
    await disconnectMac(data.mac);
    await router.blockMac(data.mac);
    return { ok: true };
  });

export const unblockMac = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, mac }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    await db.from("blocked_macs").delete().eq("mac", data.mac);
    await router.removeMac(data.mac);
    return { ok: true };
  });

/** Prepaid customers with their credit and how many subscriptions are running now. */
export const listCustomers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const nowIso = new Date().toISOString();
    const [{ data: accounts }, { data: subs }] = await Promise.all([
      db
        .from("prepaid_accounts")
        .select("phone, name, credit, net_points, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500),
      db.from("active_subscriptions").select("phone, package, expiry").eq("status", "active").gt("expiry", nowIso),
    ]);
    return (accounts ?? []).map((a) => {
      const mine = (subs ?? []).filter((s) => s.phone === a.phone);
      return { ...a, activeSubs: mine.length, latestExpiry: mine.map((s) => s.expiry).sort().at(-1) ?? null };
    });
  });

/** Admin adds (positive) or removes (negative) prepaid credit by hand. Creates the account if needed. */
export const adjustCredit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token, phone: z.string().max(20), change: z.number() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const phone = normalizePhone(data.phone);
    if (!phone) return { ok: false as const, error: "Invalid phone number" };
    const change = Math.round(data.change * 100) / 100;
    const { data: acc } = await db.from("prepaid_accounts").select("credit").eq("phone", phone).maybeSingle();
    const problem = creditChangeProblem(change, acc?.credit ?? 0);
    if (problem) return { ok: false as const, error: problem };
    const { data: credit, error } =
      change > 0
        ? await db.rpc("add_credit", { _phone: phone, _amount: change })
        : await db.rpc("spend_credit", { _phone: phone, _amount: -change });
    if (error || credit === null || credit === undefined) return { ok: false as const, error: "Could not change credit" };
    return { ok: true as const, phone, credit };
  });
