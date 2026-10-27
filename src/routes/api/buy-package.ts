import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// POST /api/buy-package  (signed-in customer)
// Headers: Authorization: Bearer <customer session token from the portal>
// Body: { "packageId": "24h", "mac": "AA:BB:CC:DD:EE:FF" }
// Pays from credit only; returns 402 when credit is too low (the portal then sends an M-Pesa prompt).
export const Route = createFileRoute("/api/buy-package")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { PACKAGE_IDS, getPackage, normalizeMac, topUpShortfall } = await import("@/lib/wifi");
        const { requireCustomer, buyFromCredit } = await import("@/lib/prepaid.server");
        const auth = request.headers.get("authorization") ?? "";
        let account;
        try {
          account = await requireCustomer(auth.replace(/^Bearer\s+/i, ""));
        } catch {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        const parsed = z
          .object({ packageId: z.enum(PACKAGE_IDS), mac: z.string().max(40) })
          .safeParse(await request.json().catch(() => null));
        const mac = parsed.success ? normalizeMac(parsed.data.mac) : null;
        if (!parsed.success || !mac) return Response.json({ ok: false, error: "Send packageId and mac" }, { status: 400 });
        const pkg = getPackage(parsed.data.packageId)!;
        const short = topUpShortfall(pkg.price, account.credit);
        if (short > 0) return Response.json({ ok: false, error: "Not enough credit", topUpNeeded: short }, { status: 402 });
        const r = await buyFromCredit(account.phone, pkg, mac);
        if (!r.ok) return Response.json(r, { status: r.insufficient ? 402 : 400 });
        return Response.json(r);
      },
    },
  },
});
