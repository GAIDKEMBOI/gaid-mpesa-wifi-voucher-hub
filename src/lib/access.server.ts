import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LOGIN_LOCK_MINUTES, computeExpiry, getPackage, isLoginLocked } from "@/lib/wifi";
import { router } from "@/lib/mikrotik.server";

export const db = supabaseAdmin;

export async function isBlocked(mac: string): Promise<boolean> {
  const { data } = await db.from("blocked_macs").select("mac").eq("mac", mac).maybeSingle();
  return Boolean(data);
}

export async function getActiveSession(mac: string) {
  const { data } = await db
    .from("users")
    .select("*")
    .eq("mac", mac)
    .eq("status", "active")
    .gt("expiry", new Date().toISOString())
    .order("expiry", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Adds the MAC to the allowed list, extending any time the customer still has. */
export async function activateAccess(input: {
  mac: string;
  phone: string | null;
  packageId: string;
  source: "mpesa" | "voucher" | "manual";
}): Promise<Date> {
  const pkg = getPackage(input.packageId);
  if (!pkg) throw new Error("Unknown package");
  const now = new Date();
  const current = await getActiveSession(input.mac);
  const expiry = computeExpiry(pkg, now, current ? new Date(current.expiry) : null);

  if (current) {
    await db
      .from("users")
      .update({
        expiry: expiry.toISOString(),
        package: pkg.id,
        phone: input.phone ?? current.phone,
        updated_at: now.toISOString(),
      })
      .eq("id", current.id);
  } else {
    await db.from("users").insert({
      mac: input.mac,
      phone: input.phone,
      package: pkg.id,
      expiry: expiry.toISOString(),
      status: "active",
      source: input.source,
    });
  }
  await router.allowMac(input.mac, expiry);
  return expiry;
}

/** Marks expired sessions and removes those MACs from the router. */
export async function sweepExpired(): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await db
    .from("users")
    .update({ status: "expired", updated_at: now })
    .eq("status", "active")
    .lte("expiry", now)
    .select("mac");
  const macs = [...new Set((data ?? []).map((r) => r.mac))];
  for (const mac of macs) {
    if (!(await getActiveSession(mac))) await router.removeMac(mac);
  }
  await db.from("active_subscriptions").update({ status: "expired", updated_at: now }).eq("status", "active").lte("expiry", now);
  return macs.length;
}

export async function disconnectMac(mac: string) {
  await db
    .from("users")
    .update({ status: "disconnected", updated_at: new Date().toISOString() })
    .eq("mac", mac)
    .eq("status", "active");
}

/**
 * Pending -> success exactly once.
 * "package" payments (old flow) grant access directly; "topup" payments add the money to the
 * customer's prepaid credit, then buy the chosen package from that credit.
 */
export async function finalizeSuccess(txnId: string, mpesaCode: string | null) {
  const { data } = await db
    .from("transactions")
    .update({
      status: "success",
      mpesa_code: mpesaCode,
      result_desc: "Paid",
      updated_at: new Date().toISOString(),
    })
    .eq("id", txnId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (!data) return; // already handled
  if (data.purpose === "topup") {
    const { error } = await db.rpc("add_credit", { _phone: data.phone, _amount: data.amount });
    if (error) {
      console.error("add_credit", error);
      return;
    }
    const pkg = getPackage(data.package);
    if (!pkg) return;
    const { buyFromCredit } = await import("@/lib/prepaid.server");
    const r = await buyFromCredit(data.phone, pkg, data.mac);
    if (!r.ok) {
      await db.from("transactions").update({ result_desc: `Paid; credit added (${r.error})` }).eq("id", txnId);
    }
    return;
  }
  await activateAccess({ mac: data.mac, phone: data.phone, packageId: data.package, source: "mpesa" });
}

/** Ensures the device is on the allowed list at least until `expiry` (never shortens existing time). */
export async function grantUntil(input: { mac: string; phone: string | null; packageId: string; expiry: Date; source: string }) {
  const current = await getActiveSession(input.mac);
  const nowIso = new Date().toISOString();
  if (current) {
    if (new Date(current.expiry).getTime() >= input.expiry.getTime()) return new Date(current.expiry);
    await db
      .from("users")
      .update({ expiry: input.expiry.toISOString(), package: input.packageId, phone: input.phone ?? current.phone, updated_at: nowIso })
      .eq("id", current.id);
  } else {
    await db.from("users").insert({
      mac: input.mac,
      phone: input.phone,
      package: input.packageId,
      expiry: input.expiry.toISOString(),
      status: "active",
      source: input.source,
    });
  }
  await router.allowMac(input.mac, input.expiry);
  return input.expiry;
}

export async function finalizeFailure(txnId: string, status: "failed" | "cancelled", desc: string) {
  await db
    .from("transactions")
    .update({ status, result_desc: desc, updated_at: new Date().toISOString() })
    .eq("id", txnId)
    .eq("status", "pending");
}

// ---------- Admin account (hashed password in DB) + signed session token ----------

const enc = new TextEncoder();
// Worker runtime caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_MS = 12 * 3600_000;

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signed token for a non-admin purpose (e.g. customer sessions); the purpose is part of the signature. */
export async function signToken(purpose: string, body: Record<string, unknown>): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(body)));
  return `${payload}.${await hmac(`${purpose}:${payload}`)}`;
}

export async function verifyToken<T>(purpose: string, token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(await hmac(`${purpose}:${payload}`), sig)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(payload))) as T;
  } catch {
    return null;
  }
}

/** Keyed hash for short secrets such as SMS codes. */
export async function keyedHash(purpose: string, value: string): Promise<string> {
  return hmac(`${purpose}:${value}`);
}

async function hmac(data: string): Promise<string> {
  const secret = process.env["ADMIN_SESSION_SECRET"];
  if (!secret) throw new Error("Server configuration error");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return b64url(new Uint8Array(bits));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    password_hash: await derive(password, salt, PBKDF2_ITERATIONS),
    password_salt: b64url(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

type AdminAccount = {
  username: string;
  password_hash: string;
  password_salt: string;
  iterations: number;
  session_version: number;
};

export async function getAdminAccount(): Promise<AdminAccount | null> {
  const { data } = await db
    .from("admin_account")
    .select("username, password_hash, password_salt, iterations, session_version")
    .eq("id", 1)
    .maybeSingle();
  return data;
}

const DUMMY_SALT = new Uint8Array(16);

/** Checks a password against the stored hash; always does the same work to avoid timing leaks. */
export async function verifyPassword(account: AdminAccount | null, password: string): Promise<boolean> {
  if (!account) {
    await derive(password, DUMMY_SALT, PBKDF2_ITERATIONS);
    return false;
  }
  const hash = await derive(password, fromB64url(account.password_salt), account.iterations);
  return safeEqual(hash, account.password_hash);
}

// ---------- Login lockout ----------

export function clientIp(): string {
  return getRequestHeader("cf-connecting-ip") || getRequestIP({ xForwardedFor: true }) || "unknown";
}

export async function loginLocked(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_LOCK_MINUTES * 60_000).toISOString();
  const [mine, all] = await Promise.all([
    db
      .from("admin_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .eq("success", false)
      .gte("created_at", since),
    db
      .from("admin_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("success", false)
      .gte("created_at", since),
  ]);
  return isLoginLocked(mine.count ?? 0, all.count ?? 0);
}

export async function recordAttempt(ip: string, success: boolean) {
  await db.from("admin_login_attempts").insert({ ip, success });
  if (success) {
    // A successful login clears that device's failures.
    await db.from("admin_login_attempts").delete().eq("ip", ip).eq("success", false);
  }
  await db
    .from("admin_login_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 86400_000).toISOString());
}

// ---------- Session token ----------

export async function createAdminToken(sessionVersion: number): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_MS, v: sessionVersion })));
  return `${payload}.${await hmac(payload)}`;
}

/** Valid signature, not expired, and issued for the current password (changing it logs out old sessions). */
export async function requireAdmin(token: string | undefined) {
  if (!token) throw new Error("Please log in again");
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(await hmac(payload), sig)) throw new Error("Please log in again");
  let json: { exp: number; v?: number };
  try {
    json = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    throw new Error("Please log in again");
  }
  if (json.exp < Date.now()) throw new Error("Session expired. Please log in again");
  const account = await getAdminAccount();
  if (!account || json.v !== account.session_version) throw new Error("Please log in again");
  return account;
}
