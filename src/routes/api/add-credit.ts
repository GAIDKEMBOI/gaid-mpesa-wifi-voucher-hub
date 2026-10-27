import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// POST /api/add-credit  (admin only)
// Headers: Authorization: Bearer <admin session token from /admin>
// Body: { "phone": "0712345678", "amount": 50 }
const Body = z.object({ phone: z.string().max(20), amount: z.number().positive().max(100_000) });

export const Route = createFileRoute("/api/add-credit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireAdmin, db } = await import("@/lib/access.server");
        const { normalizePhone } = await import("@/lib/wifi");
        const auth = request.headers.get("authorization") ?? "";
        try {
          await requireAdmin(auth.replace(/^Bearer\s+/i, ""));
        } catch {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, error: "Send phone and a positive amount" }, { status: 400 });
        const phone = normalizePhone(parsed.data.phone);
        if (!phone) return Response.json({ ok: false, error: "Invalid phone number" }, { status: 400 });
        const { data: credit, error } = await db.rpc("add_credit", { _phone: phone, _amount: parsed.data.amount });
        if (error) return Response.json({ ok: false, error: "Could not add credit" }, { status: 500 });
        return Response.json({ ok: true, phone, credit });
      },
    },
  },
});
