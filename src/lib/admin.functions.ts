import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  MAX_VOUCHERS_PER_BATCH,
  PACKAGE_IDS,
  makeVoucherCode,
  normalizeMac,
  normalizePhone,
  startOfKenyaDay,
} from "@/lib/wifi";
import {
  activateAccess,
  adminCredentials,
  createAdminToken,
  db,
  disconnectMac,
  requireAdmin,
  sweepExpired,
} from "@/lib/access.server";
import { router, routerMode } from "@/lib/mikrotik.server";
import { mpesaMode } from "@/lib/mpesa.server";

const token = z.string().max(500);
const mac = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const m = normalizeMac(v);
    if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid MAC address" });
    return m ?? "";
  });

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ username: z.string().max(100), password: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const c = adminCredentials();
    if (data.username.trim() !== c.username || data.password !== c.password) {
      return { ok: false as const, error: "Wrong username or password" };
    }
    return { ok: true as const, token: await createAdminToken() };
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
      routerMode: routerMode(),
    };
  });

export const listTransactions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.token);
    const { data: rows } = await db
      .from("transactions")
      .select("id, phone, mac, package, amount, mpesa_code, status, result_desc, is_mock, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    return rows ?? [];
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
