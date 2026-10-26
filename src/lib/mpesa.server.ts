// Safaricom Daraja — Lipa Na M-Pesa Online (STK Push).
// Falls back to mock mode when keys are not configured.

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortcode: string; // Paybill number, or the Store/Head-office number for a Till
  passkey: string;
  tillNumber?: string | undefined; // set for Buy Goods (Till)
  baseUrl: string;
}

const REQUIRED_KEYS = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"] as const;

// Pasted values often carry stray spaces or line breaks; strip them.
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function getMpesaConfig(): MpesaConfig | null {
  const consumerKey = env("MPESA_CONSUMER_KEY");
  const consumerSecret = env("MPESA_CONSUMER_SECRET");
  const shortcode = env("MPESA_SHORTCODE");
  const passkey = env("MPESA_PASSKEY");
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) return null;
  const mode = (env("MPESA_ENV") ?? "sandbox").toLowerCase();
  const live = mode === "production" || mode === "live";
  return {
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    tillNumber: env("MPESA_TILL_NUMBER"),
    baseUrl: live ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
  };
}

/** Names of required M-Pesa settings that are missing (never values). */
export function mpesaMissingKeys(): string[] {
  return REQUIRED_KEYS.filter((k) => !env(k));
}

export function mpesaMode(): "live" | "sandbox" | "mock" {
  const cfg = getMpesaConfig();
  if (!cfg) return "mock";
  return cfg.baseUrl.includes("sandbox") ? "sandbox" : "live";
}

function timestamp(): string {
  // Daraja expects YYYYMMDDHHmmss in Kenya time
  const d = new Date(Date.now() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function getAccessToken(cfg: MpesaConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`)}` },
  });
  if (!res.ok) {
    console.error("Daraja token error", res.status, await res.text());
    throw new Error("Could not reach M-Pesa. Please try again.");
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
}

export async function stkPush(
  cfg: MpesaConfig,
  input: { phone: string; amount: number; callbackUrl: string; reference: string; description: string },
): Promise<StkPushResult> {
  const token = await getAccessToken(cfg);
  const ts = timestamp();
  const password = btoa(`${cfg.shortcode}${cfg.passkey}${ts}`);
  const isTill = Boolean(cfg.tillNumber);
  const res = await fetch(`${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: isTill ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: input.amount,
      PartyA: input.phone,
      PartyB: isTill ? cfg.tillNumber : cfg.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.reference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok || json["ResponseCode"] !== "0") {
    console.error("Daraja STK error", res.status, json);
    throw new Error(json["errorMessage"] || json["CustomerMessage"] || "M-Pesa request failed. Try again.");
  }
  return {
    merchantRequestId: json["MerchantRequestID"] ?? "",
    checkoutRequestId: json["CheckoutRequestID"] ?? "",
  };
}

export type StkQueryOutcome =
  | { state: "pending" }
  | { state: "success" }
  | { state: "failed" | "cancelled"; desc: string };

export async function stkQuery(cfg: MpesaConfig, checkoutRequestId: string): Promise<StkQueryOutcome> {
  const token = await getAccessToken(cfg);
  const ts = timestamp();
  const res = await fetch(`${cfg.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: btoa(`${cfg.shortcode}${cfg.passkey}${ts}`),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string>;
  // While the customer hasn't answered, Daraja returns an error code "500.001.1001"
  if (json["errorCode"] || json["ResultCode"] === undefined) return { state: "pending" };
  return interpretResultCode(String(json["ResultCode"]), json["ResultDesc"] ?? "");
}

export function interpretResultCode(code: string, desc: string): StkQueryOutcome {
  if (code === "0") return { state: "success" };
  if (code === "1032") return { state: "cancelled", desc: "You cancelled the payment." };
  if (code === "1037") return { state: "failed", desc: "No response from your phone. Try again." };
  if (code === "1") return { state: "failed", desc: "Not enough M-Pesa balance." };
  if (code === "2001") return { state: "failed", desc: "Wrong M-Pesa PIN." };
  return { state: "failed", desc: desc || "Payment failed." };
}
