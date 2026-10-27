// Prepaid accounts: phone sign-in codes, credit, subscriptions with device slots, free WiFi.
import {
  FREE_WIFI_END_HOUR,
  FREE_WIFI_START_HOUR,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  computeExpiry,
  freeWifiEndsAt,
  getPackage,
  hasFreeSlot,
  isFreeWifiTime,
  kenyaDay,
  type WifiPackage,
} from "@/lib/wifi";
import { db, getActiveSession, grantUntil, isBlocked, keyedHash, safeEqual, signToken, verifyToken } from "@/lib/access.server";
import { sendSms, smsMode } from "@/lib/sms.server";

const CUSTOMER_SESSION_MS = 30 * 86400_000;

// ---------- Sign-in codes ----------

export async function requestOtp(phone: string): Promise<{ ok: true; testCode?: string } | { ok: false; error: string }> {
  const now = Date.now();
  const { data: prev } = await db.from("phone_otps").select("*").eq("phone", phone).maybeSingle();
  let sends = 1;
  let windowStart = new Date(now).toISOString();
  if (prev) {
    const since = now - new Date(prev.last_sent_at).getTime();
    if (since < OTP_RESEND_SECONDS * 1000)
      return { ok: false, error: `Wait ${Math.ceil(OTP_RESEND_SECONDS - since / 1000)}s before asking for a new code` };
    const inWindow = now - new Date(prev.window_start).getTime() < 3600_000;
    if (inWindow) {
      if (prev.sends_in_window >= OTP_MAX_SENDS_PER_HOUR)
        return { ok: false, error: "Too many codes requested. Try again in an hour." };
      sends = prev.sends_in_window + 1;
      windowStart = prev.window_start;
    }
  }
  const digits = crypto.getRandomValues(new Uint32Array(1))[0]! % 10 ** OTP_LENGTH;
  const code = String(digits).padStart(OTP_LENGTH, "0");
  await db.from("phone_otps").upsert({
    phone,
    code_hash: await keyedHash("otp", `${phone}:${code}`),
    expires_at: new Date(now + OTP_TTL_MINUTES * 60_000).toISOString(),
    attempts: 0,
    sends_in_window: sends,
    window_start: windowStart,
    last_sent_at: new Date(now).toISOString(),
  });
  if (smsMode() === "test") return { ok: true, testCode: code };
  try {
    await sendSms(phone, `${code} is your GAID WIFI SERVICES sign-in code. It expires in ${OTP_TTL_MINUTES} minutes.`);
  } catch {
    return { ok: false, error: "Could not send the SMS. Try again in a minute." };
  }
  return { ok: true };
}

export async function verifyOtp(phone: string, code: string, name: string | null) {
  const { data: otp } = await db.from("phone_otps").select("*").eq("phone", phone).maybeSingle();
  if (!otp || new Date(otp.expires_at).getTime() < Date.now())
    return { ok: false as const, error: "Code expired. Ask for a new one." };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false as const, error: "Too many wrong codes. Ask for a new one." };
  const hash = await keyedHash("otp", `${phone}:${code}`);
  if (!safeEqual(hash, otp.code_hash)) {
    await db.from("phone_otps").update({ attempts: otp.attempts + 1 }).eq("phone", phone);
    return { ok: false as const, error: "Wrong code" };
  }
  await db.from("phone_otps").delete().eq("phone", phone);

  const { data: existing } = await db.from("prepaid_accounts").select("*").eq("phone", phone).maybeSingle();
  let account = existing;
  if (!account) {
    const { data: created } = await db
      .from("prepaid_accounts")
      .upsert({ phone, name }, { onConflict: "phone" })
      .select("*")
      .single();
    account = created;
  } else if (name && !account.name) {
    await db.from("prepaid_accounts").update({ name, updated_at: new Date().toISOString() }).eq("phone", phone);
  }
  if (!account) return { ok: false as const, error: "Could not sign in. Try again." };
  const token = await signToken("cust", { p: phone, v: account.session_version, exp: Date.now() + CUSTOMER_SESSION_MS });
  return { ok: true as const, token };
}

export async function requireCustomer(token: string | undefined) {
  const t = await verifyToken<{ p: string; v: number; exp: number }>("cust", token);
  if (!t || t.exp < Date.now()) throw new Error("Please sign in again");
  const { data: account } = await db.from("prepaid_accounts").select("*").eq("phone", t.p).maybeSingle();
  if (!account || account.session_version !== t.v) throw new Error("Please sign in again");
  return account;
}

// ---------- Subscriptions ----------

async function attachDevice(subscriptionId: string, phone: string, packageId: string, mac: string, expiry: Date) {
  await db.from("subscription_devices").upsert({ subscription_id: subscriptionId, mac }, { onConflict: "subscription_id,mac" });
  return grantUntil({ mac, phone, packageId, expiry, source: packageId === "free" ? "free" : "credit" });
}

/** Deducts the price from credit, then starts (or extends) a subscription and puts this device online. */
export async function buyFromCredit(
  phone: string,
  pkg: WifiPackage,
  mac: string,
): Promise<{ ok: true; expiry: string } | { ok: false; error: string; insufficient?: boolean }> {
  if (await isBlocked(mac)) return { ok: false, error: "This device is blocked. Contact the admin." };
  const { data: left, error } = await db.rpc("spend_credit", { _phone: phone, _amount: pkg.price });
  if (error || left === null || left === undefined)
    return { ok: false, error: "Not enough credit", insufficient: true };

  try {
    const now = new Date();
    // Same package already running on this device? Add the time to it.
    const { data: mine } = await db
      .from("subscription_devices")
      .select("subscription_id, active_subscriptions!inner(id, package, expiry, status, phone)")
      .eq("mac", mac)
      .eq("active_subscriptions.phone", phone)
      .eq("active_subscriptions.package", pkg.id)
      .eq("active_subscriptions.status", "active")
      .gt("active_subscriptions.expiry", now.toISOString())
      .limit(1);
    const running = mine?.[0]?.active_subscriptions;
    if (running) {
      const expiry = computeExpiry(pkg, now, new Date(running.expiry));
      await db
        .from("active_subscriptions")
        .update({ expiry: expiry.toISOString(), updated_at: now.toISOString() })
        .eq("id", running.id);
      const { data: devs } = await db.from("subscription_devices").select("mac").eq("subscription_id", running.id);
      for (const d of devs ?? []) await grantUntil({ mac: d.mac, phone, packageId: pkg.id, expiry, source: "credit" });
      return { ok: true, expiry: expiry.toISOString() };
    }

    const expiry = computeExpiry(pkg, now);
    const { data: sub, error: subErr } = await db
      .from("active_subscriptions")
      .insert({ phone, package: pkg.id, devices: pkg.devices, price: pkg.price, expiry: expiry.toISOString(), source: "credit" })
      .select("id")
      .single();
    if (subErr || !sub) throw subErr ?? new Error("subscription insert failed");
    const granted = await attachDevice(sub.id, phone, pkg.id, mac, expiry);
    return { ok: true, expiry: granted.toISOString() };
  } catch (e) {
    console.error("buyFromCredit", e);
    await db.rpc("add_credit", { _phone: phone, _amount: pkg.price }); // refund
    return { ok: false, error: "Could not start the package. Your credit was not used." };
  }
}

/** Adds this device to a multi-device subscription when a slot is free. */
export async function useSlot(phone: string, subscriptionId: string, mac: string) {
  if (await isBlocked(mac)) return { ok: false as const, error: "This device is blocked. Contact the admin." };
  const { data: sub } = await db
    .from("active_subscriptions")
    .select("*, subscription_devices(mac)")
    .eq("id", subscriptionId)
    .eq("phone", phone)
    .maybeSingle();
  if (!sub || sub.status !== "active" || new Date(sub.expiry).getTime() <= Date.now())
    return { ok: false as const, error: "This subscription has ended" };
  const macs = sub.subscription_devices.map((d) => d.mac);
  if (macs.includes(mac)) {
    const expiry = await grantUntil({ mac, phone, packageId: sub.package, expiry: new Date(sub.expiry), source: "credit" });
    return { ok: true as const, expiry: expiry.toISOString() };
  }
  if (!hasFreeSlot(sub.devices, macs.length)) return { ok: false as const, error: "All device slots are in use" };
  const expiry = await attachDevice(sub.id, phone, sub.package, mac, new Date(sub.expiry));
  return { ok: true as const, expiry: expiry.toISOString() };
}

/** Free WiFi 6-8 AM: once per account and once per device each day, until 8:00 AM. */
export async function claimFreeWifi(phone: string, mac: string) {
  const now = new Date();
  if (!isFreeWifiTime(now))
    return { ok: false as const, error: `Free WiFi is only from ${FREE_WIFI_START_HOUR}:00 to ${FREE_WIFI_END_HOUR}:00 AM` };
  if (await isBlocked(mac)) return { ok: false as const, error: "This device is blocked. Contact the admin." };
  const { error } = await db.from("free_wifi_claims").insert({ phone, mac, day: kenyaDay(now) });
  if (error) return { ok: false as const, error: "Free WiFi already used today on this account or device" };
  const expiry = freeWifiEndsAt(now);
  const { data: sub } = await db
    .from("active_subscriptions")
    .insert({ phone, package: "free", devices: 1, price: 0, expiry: expiry.toISOString(), source: "free" })
    .select("id")
    .single();
  if (sub) await attachDevice(sub.id, phone, "free", mac, expiry);
  else await grantUntil({ mac, phone, packageId: "free", expiry, source: "free" });
  return { ok: true as const, expiry: expiry.toISOString() };
}

export async function accountOverview(phone: string, mac: string | null) {
  const now = new Date();
  const [{ data: account }, { data: subs }, freeClaim, session] = await Promise.all([
    db.from("prepaid_accounts").select("phone, name, credit, net_points").eq("phone", phone).single(),
    db
      .from("active_subscriptions")
      .select("id, package, devices, expiry, source, subscription_devices(mac)")
      .eq("phone", phone)
      .eq("status", "active")
      .gt("expiry", now.toISOString())
      .order("expiry", { ascending: false }),
    db.from("free_wifi_claims").select("day").eq("phone", phone).eq("day", kenyaDay(now)).maybeSingle(),
    mac ? getActiveSession(mac) : Promise.resolve(null),
  ]);
  return {
    phone,
    name: account?.name ?? null,
    credit: account?.credit ?? 0,
    netPoints: account?.net_points ?? 0,
    subscriptions: (subs ?? []).map((s) => {
      const macs = s.subscription_devices.map((d) => d.mac);
      return {
        id: s.id,
        package: s.package,
        label: s.package === "free" ? "Free WiFi Kila Siku" : (getPackage(s.package)?.label ?? s.package),
        slots: s.devices,
        used: macs.length,
        thisDevice: mac ? macs.includes(mac) : false,
        expiry: s.expiry,
      };
    }),
    freeWifi: { now: isFreeWifiTime(now), claimedToday: Boolean(freeClaim.data) },
    device: session ? { expiry: session.expiry } : null,
    smsMode: smsMode(),
  };
}
