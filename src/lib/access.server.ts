import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeExpiry, getPackage } from "@/lib/wifi";
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
  return macs.length;
}

export async function disconnectMac(mac: string) {
  await db
    .from("users")
    .update({ status: "disconnected", updated_at: new Date().toISOString() })
    .eq("mac", mac)
    .eq("status", "active");
}

/** Pending -> success exactly once, then grants access. */
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
  await activateAccess({ mac: data.mac, phone: data.phone, packageId: data.package, source: "mpesa" });
}

export async function finalizeFailure(txnId: string, status: "failed" | "cancelled", desc: string) {
  await db
    .from("transactions")
    .update({ status, result_desc: desc, updated_at: new Date().toISOString() })
    .eq("id", txnId)
    .eq("status", "pending");
}

// ---------- Admin session (signed token, no database user needed) ----------

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const secret = process.env["ADMIN_SESSION_SECRET"];
  if (!secret) throw new Error("Server configuration error");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export function adminCredentials() {
  return {
    username: process.env["ADMIN_USERNAME"] || "admin",
    password: process.env["ADMIN_PASSWORD"] || "admin123",
  };
}

export async function createAdminToken(): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + 12 * 3600_000 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function requireAdmin(token: string | undefined) {
  if (!token) throw new Error("Please log in again");
  const [payload, sig] = token.split(".");
  if (!payload || !sig || (await hmac(payload)) !== sig) throw new Error("Please log in again");
  const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp: number };
  if (json.exp < Date.now()) throw new Error("Session expired. Please log in again");
}
