// Shared, browser-safe business rules for GAID WIFI SERVICES.

export type PackageId = "1h" | "6h" | "24h" | "7d";

export interface WifiPackage {
  id: PackageId;
  label: string;
  price: number; // KES
  minutes: number;
}

export const PACKAGES: WifiPackage[] = [
  { id: "1h", label: "1 Hour", price: 20, minutes: 60 },
  { id: "6h", label: "6 Hours", price: 50, minutes: 6 * 60 },
  { id: "24h", label: "24 Hours", price: 100, minutes: 24 * 60 },
  { id: "7d", label: "7 Days", price: 500, minutes: 7 * 24 * 60 },
];

export const PACKAGE_IDS = PACKAGES.map((p) => p.id) as [PackageId, ...PackageId[]];

export function getPackage(id: string): WifiPackage | undefined {
  return PACKAGES.find((p) => p.id === id);
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
