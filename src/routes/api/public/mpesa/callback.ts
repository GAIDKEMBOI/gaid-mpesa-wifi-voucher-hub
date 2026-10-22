import { createFileRoute } from "@tanstack/react-router";

// Safaricom calls this after the customer answers the STK prompt.
// Each payment gets a secret one-time token in its callback URL, so only
// Safaricom (who received that URL) can confirm a payment.
const ACK = () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" });

export const Route = createFileRoute("/api/public/mpesa/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { db, finalizeFailure, finalizeSuccess } = await import("@/lib/access.server");
        const { interpretResultCode } = await import("@/lib/mpesa.server");
        const token = new URL(request.url).searchParams.get("t") ?? "";
        let body: {
          Body?: {
            stkCallback?: {
              CheckoutRequestID?: string;
              ResultCode?: number | string;
              ResultDesc?: string;
              CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
            };
          };
        };
        try {
          body = await request.json();
        } catch {
          return ACK();
        }
        const cb = body.Body?.stkCallback;
        if (!cb?.CheckoutRequestID || token.length < 30) return ACK();

        const { data: txn } = await db
          .from("transactions")
          .select("id, amount, callback_token, status")
          .eq("checkout_request_id", cb.CheckoutRequestID)
          .maybeSingle();
        if (!txn || txn.callback_token !== token || txn.status !== "pending") return ACK();

        const result = interpretResultCode(String(cb.ResultCode), cb.ResultDesc ?? "");
        if (result.state === "success") {
          const items = cb.CallbackMetadata?.Item ?? [];
          const amount = Number(items.find((i) => i.Name === "Amount")?.Value ?? 0);
          const receipt = String(items.find((i) => i.Name === "MpesaReceiptNumber")?.Value ?? "") || null;
          if (amount < txn.amount) {
            await finalizeFailure(txn.id, "failed", `Amount mismatch (${amount})`);
          } else {
            await finalizeSuccess(txn.id, receipt);
          }
        } else if (result.state !== "pending") {
          await finalizeFailure(txn.id, result.state, result.desc);
        }
        return ACK();
      },
    },
  },
});
