// Shared, browser-safe business rules for GAID WIFI SERVICES.

// Packages are managed by the admin and stored in the database (wifi_packages).
export type PackageId = string;

export interface WifiPackage {
  id: PackageId;
  label: string;
  price: number; // KES
  minutes: number;
  devices: number; // how many devices may use it at the same time
  speedMbps?: number | null;
}

/** The list the database was first filled with. The live list is whatever the admin keeps in the database. */
export const STARTING_PACKAGES: WifiPackage[] = [
  { id: "30m", label: "30 Mins", price: 5, minutes: 30, devices: 1 },
  { id: "1h", label: "1 Hour", price: 10, minutes: 60, devices: 1 },
  { id: "2h", label: "2 Hours", price: 12, minutes: 2 * 60, devices: 1 },
  { id: "4h", label: "4 Hours", price: 20, minutes: 4 * 60, devices: 1 },
  { id: "12h", label: "12 Hours", price: 30, minutes: 12 * 60, devices: 1 },
  { id: "24h", label: "24 Hours", price: 45, minutes: 24 * 60, devices: 1 },
  { id: "7d", label: "1 Week", price: 200, minutes: 7 * 24 * 60, devices: 1 },
  { id: "30d", label: "1 Month", price: 600, minutes: 30 * 24 * 60, devices: 1 },
  { id: "4h-2d", label: "4HRS 2 Devices", price: 30, minutes: 4 * 60, devices: 2, speedMbps: 5 },
  { id: "24h-2d", label: "24HRS 2 Devices", price: 70, minutes: 24 * 60, devices: 2, speedMbps: 5 },
  { id: "3d-2d", label: "3 Days 2 Devices", price: 135, minutes: 72 * 60, devices: 2, speedMbps: 5 },
];

export function findPackage<T extends WifiPackage>(list: T[], id: string): T | undefined {
  return list.find((p) => p.id === id);
}

/** Package id field in requests: any short id; the server checks it exists. */
export const PACKAGE_ID_MAX = 40;

// ---------- Admin package editing rules ----------

export const PACKAGE_PRICE_MAX = 100_000; // KES
export const PACKAGE_MINUTES_MAX = 365 * 24 * 60; // 1 year
export const PACKAGE_DEVICES_MAX = 20;
export const PACKAGE_SPEED_MAX = 10_000; // Mbps

export interface PackageInput {
  label: string;
  price: number;
  minutes: number;
  devices: number;
  speedMbps: number | null;
}

/** Reason a package the admin typed is not allowed, or null when it is fine. */
export function packageProblem(p: PackageInput): string | null {
  const label = p.label.trim();
  if (label.length < 2) return "Give the package a name";
  if (label.length > 40) return "Name is too long (40 letters max)";
  if (!Number.isInteger(p.price) || p.price < 1) return "Price must be at least Sh1, whole shillings";
  if (p.price > PACKAGE_PRICE_MAX) return `Price can't be more than Sh${PACKAGE_PRICE_MAX.toLocaleString("en-KE")}`;
  if (!Number.isInteger(p.minutes) || p.minutes < 1) return "Time must be at least 1 minute";
  if (p.minutes > PACKAGE_MINUTES_MAX) return "Time can't be more than 1 year";
  if (!Number.isInteger(p.devices) || p.devices < 1) return "At least 1 device";
  if (p.devices > PACKAGE_DEVICES_MAX) return `At most ${PACKAGE_DEVICES_MAX} devices`;
  if (p.speedMbps !== null && (!Number.isInteger(p.speedMbps) || p.speedMbps < 1 || p.speedMbps > PACKAGE_SPEED_MAX))
    return "Speed must be a whole number of Mbps, or left empty";
  return null;
}

/** Short id for a new package from its name, unique among existing ids (e.g. "2 Hours Promo" -> "2-hours-promo"). */
export function newPackageId(label: string, existing: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30)
      .replace(/-+$/g, "") || "pkg";
  const taken = new Set(existing);
  if (!taken.has(base) && base !== "free") return base;
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

export type DurationUnit = "minutes" | "hours" | "days";
export const DURATION_UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 24 * 60 };

/** Picks the biggest unit that divides the minutes evenly (1440 -> 1 days, 90 -> 90 minutes). */
export function splitDuration(minutes: number): { amount: number; unit: DurationUnit } {
  if (minutes % DURATION_UNIT_MINUTES.days === 0) return { amount: minutes / DURATION_UNIT_MINUTES.days, unit: "days" };
  if (minutes % DURATION_UNIT_MINUTES.hours === 0) return { amount: minutes / DURATION_UNIT_MINUTES.hours, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

/** Customer order: single-device first, then by price. */
export function sortPackages<T extends WifiPackage>(list: T[]): T[] {
  return [...list].sort((a, b) => a.devices - b.devices || a.price - b.price || a.minutes - b.minutes);
}

/** New expiry: extends from the current expiry when the customer still has time left. */
export function computeExpiry(pkg: WifiPackage, now: Date, currentExpiry?: Date | null): Date {
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return new Date(base.getTime() + pkg.minutes * 60_000);
}

/** Normalises a Kenyan Safaricom number to 2547XXXXXXXX / 2541XXXXXXXX, or null if invalid. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  let local: string;
  if (/^0[17]\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^254[17]\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^[17]\d{8}$/.test(digits)) local = digits;
  else return null;
  return `254${local}`;
}

/** Normalises a MAC address to AA:BB:CC:DD:EE:FF, or null if invalid. */
export function normalizeMac(input: string): string | null {
  const hex = input.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) return null;
  if (input.replace(/[0-9a-fA-F:\-.\s]/g, "").length > 0) return null;
  return hex.toUpperCase().match(/.{2}/g)!.join(":");
}

/** "23:59:00" for under a day, "6d 23:59:00" for longer. */
export function formatTimeLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

// No 0/O/1/I/L to avoid mistakes when customers type codes.
export const VOUCHER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const VOUCHER_LENGTH = 8;

export function makeVoucherCode(randomBytes: Uint8Array): string {
  let code = "";
  for (let i = 0; i < VOUCHER_LENGTH; i++) {
    code += VOUCHER_ALPHABET[(randomBytes[i] ?? 0) % VOUCHER_ALPHABET.length];
  }
  return code;
}

export function normalizeVoucher(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const MAX_VOUCHERS_PER_BATCH = 500;

/** Start of "today" in Kenya time (UTC+3), returned as a UTC Date. */
export function startOfKenyaDay(now: Date): Date {
  const offset = 3 * 3600_000;
  const local = new Date(now.getTime() + offset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offset);
}

// ---------- Admin account rules ----------

export const ADMIN_PASSWORD_MIN_LENGTH = 10;
export const LOGIN_LOCK_MINUTES = 15;
export const LOGIN_MAX_FAILS_PER_DEVICE = 5;
export const LOGIN_MAX_FAILS_TOTAL = 50;

const COMMON_PASSWORDS = [
  "admin123",
  "password",
  "password1",
  "password123",
  "1234567890",
  "12345678",
  "123456789",
  "qwerty123",
  "qwertyuiop",
  "admin12345",
  "administrator",
  "iloveyou",
];

/** Trimmed, lowercased username of 3-40 letters/numbers/._-, or null. */
export function normalizeAdminUsername(input: string): string | null {
  const u = input.trim().toLowerCase();
  return /^[a-z0-9._-]{3,40}$/.test(u) ? u : null;
}

/** Returns a reason the admin password is too weak, or null when it is acceptable. */
export function adminPasswordProblem(password: string, username = ""): string | null {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH)
    return `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`;
  if (password.length > 200) return "Password is too long";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "Use both letters and numbers";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.includes(lower)) return "This password is too common";
  if (username && lower.includes(username.toLowerCase())) return "Password must not contain the username";
  if (/^(.)\1+$/.test(password)) return "Password is too simple";
  return null;
}

/** Login is locked when one device or the whole system has too many recent failures. */
export function isLoginLocked(failsFromDevice: number, failsTotal: number): boolean {
  return failsFromDevice >= LOGIN_MAX_FAILS_PER_DEVICE || failsTotal >= LOGIN_MAX_FAILS_TOTAL;
}

// ---------- Payment (STK push) status rules ----------

/** A payment still pending after this long is treated as failed (customer never entered the PIN). */
export const PAYMENT_TIMEOUT_MS = 3 * 60_000;

export type PaymentState = "pending" | "success" | "failed";
export type AccessState = "waiting" | "on" | "ended" | "not_activated" | "none";

/** Collapses stored payment statuses into the three states shown to the admin. */
export function paymentState(status: string): PaymentState {
  if (status === "success") return "success";
  if (status === "pending") return "pending";
  return "failed";
}

/**
 * What a payment did for the customer's internet.
 * accessUntil = latest expiry granted to that device at/after payment (null if no access was granted).
 */
export function paymentAccess(status: string, accessUntil: Date | null, now: Date, stillActive: boolean): AccessState {
  const s = paymentState(status);
  if (s === "pending") return "waiting";
  if (s === "failed") return "none";
  if (!accessUntil) return "not_activated";
  return stillActive && accessUntil.getTime() > now.getTime() ? "on" : "ended";
}

// ---------- Prepaid credit, sign-in codes and free WiFi ----------

/** Amount (whole KES) the customer must top up to afford a price; 0 when credit is enough. */
export function topUpShortfall(price: number, credit: number): number {
  return Math.max(0, Math.ceil(price - credit));
}

/** Can another device join a subscription with this many slots? */
export function hasFreeSlot(slots: number, used: number): boolean {
  return used < slots;
}

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;

export const FREE_WIFI_START_HOUR = 6; // Kenya time
export const FREE_WIFI_END_HOUR = 8;

const KENYA_OFFSET_MS = 3 * 3600_000;

function kenyaHour(now: Date): number {
  return new Date(now.getTime() + KENYA_OFFSET_MS).getUTCHours();
}

/** Free WiFi runs daily from 6:00 to 8:00 AM Kenya time. */
export function isFreeWifiTime(now: Date): boolean {
  const h = kenyaHour(now);
  return h >= FREE_WIFI_START_HOUR && h < FREE_WIFI_END_HOUR;
}

/** 8:00 AM Kenya time on the current Kenya day. */
export function freeWifiEndsAt(now: Date): Date {
  return new Date(startOfKenyaDay(now).getTime() + FREE_WIFI_END_HOUR * 3600_000);
}

/** Kenya calendar day as YYYY-MM-DD. */
export function kenyaDay(now: Date): string {
  return new Date(now.getTime() + KENYA_OFFSET_MS).toISOString().slice(0, 10);
}

/** "Good Morning" before 12:00, "Good Afternoon" before 17:00, else "Good Evening" (Kenya time). */
export function greeting(now: Date): string {
  const h = kenyaHour(now);
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

/** Customer-facing package line, e.g. "Sh5 = 30 Mins UnlimiNET - 1 Device". */
export function packageLine(p: WifiPackage): string {
  return `Sh${p.price} = ${p.label.replace(/ \d+ Devices$/, "")} UnlimiNET - ${p.devices} Device${p.devices > 1 ? "s" : ""}`;
}

// ---------- Credit top-up (M-Pesa into prepaid credit only) ----------

export const TOPUP_MIN = 5; // KES
export const TOPUP_MAX = 10_000; // KES

/** Reason a credit top-up amount is not allowed, or null when it is fine. Whole shillings only. */
export function topUpAmountProblem(amount: number): string | null {
  if (!Number.isInteger(amount)) return "Use whole shillings";
  if (amount < TOPUP_MIN) return `Top up at least Sh${TOPUP_MIN}`;
  if (amount > TOPUP_MAX) return `Top up at most Sh${TOPUP_MAX.toLocaleString("en-KE")}`;
  return null;
}

/** Admin credit change: positive adds, negative removes; never more than the customer has. */
export function creditChangeProblem(change: number, currentCredit: number): string | null {
  if (!Number.isFinite(change) || change === 0) return "Enter an amount";
  if (Math.abs(change) > 100_000) return "Amount is too large";
  if (change < 0 && -change > currentCredit) return "Customer does not have that much credit";
  return null;
}
