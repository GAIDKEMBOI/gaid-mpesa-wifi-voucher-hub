import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Runs every minute: marks finished sessions as expired and cuts them off the router.
export const Route = createFileRoute("/api/public/jobs/expire-users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { sweepExpired } = await import("@/lib/access.server");
        const expired = await sweepExpired();
        return Response.json({ success: true, expired });
      },
    },
  },
});
