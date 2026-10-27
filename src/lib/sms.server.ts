// SMS sending for customer sign-in codes.
// Uses the GatewayAPI connector when linked; otherwise "test" mode shows the code on screen.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/gatewayapi";

export function smsMode(): "gatewayapi" | "test" {
  return process.env["GATEWAYAPI_API_KEY"] && process.env["LOVABLE_API_KEY"] ? "gatewayapi" : "test";
}

/** phone is 2547XXXXXXXX. */
export async function sendSms(phone: string, message: string): Promise<void> {
  const apiKey = process.env["GATEWAYAPI_API_KEY"];
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey || !lovableKey) throw new Error("SMS is not configured");
  const res = await fetch(`${GATEWAY_URL}/mobile/single`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: process.env["SMS_SENDER_NAME"]?.trim() || "GAIDWIFI",
      recipient: Number(phone),
      message,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`SMS send failed [${res.status}]: ${body}`);
    throw new Error(`SMS send failed [${res.status}]`);
  }
}
