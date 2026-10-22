import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Hotspot Setup Guide — GAID WIFI SERVICES" },
      {
        name: "description",
        content: "Connect the Safaricom fibre router, MikroTik hotspot and CPE210 / Tenda O3 to broadcast GAID WIFI SERVICES.",
      },
      { property: "og:title", content: "Hotspot Setup Guide — GAID WIFI SERVICES" },
      { property: "og:description", content: "Wiring, captive portal popup and M-Pesa setup for GAID WIFI SERVICES." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetupPage,
});

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-border bg-background p-3 pr-12 font-mono text-xs leading-relaxed">
        {children}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-1 top-1"
        aria-label="Copy"
        onClick={() => navigator.clipboard.writeText(children).then(() => toast.success("Copied"))}
      >
        <Copy />
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="font-display flex items-center gap-3 text-2xl">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-base text-primary-foreground">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

function Box({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-center font-semibold ${accent ? "border-primary text-primary" : "border-border text-foreground"}`}>
      {children}
    </div>
  );
}

function SetupPage() {
  const [origin, setOrigin] = useState("https://YOUR-APP-LINK");
  useEffect(() => setOrigin(window.location.origin), []);
  const host = origin.replace(/^https?:\/\//, "");

  const loginHtml = `<html><head>
<meta http-equiv="refresh" content="0; url=${origin}/?mac=$(mac)&ip=$(ip)&link-orig=$(link-orig-esc)">
</head><body>Loading GAID WIFI SERVICES...</body></html>`;

  const mikrotik = `/ip hotspot walled-garden
add dst-host=${host}
add dst-host=*.lovable.app
add dst-host=fonts.googleapis.com
add dst-host=fonts.gstatic.com
add dst-host=*.safaricom.co.ke
/ip service set www-ssl disabled=no
/user add name=gaidapi group=full password=CHANGE-ME`;

  return (
    <main className="bg-hero min-h-dvh">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <header className="mb-2">
          <Link to="/admin" className="text-sm text-primary hover:underline">
            ← Back to admin
          </Link>
          <h1 className="font-display mt-2 text-5xl leading-none">
            GAID <span className="text-primary">WIFI</span> SERVICES SETUP
          </h1>
          <p className="mt-2 text-muted-foreground">From Safaricom fibre to a working “Sign in to GAID WIFI SERVICES” popup.</p>
        </header>

        <Step n={1} title="Wiring">
          <p>
            Basic: <strong>Safaricom router LAN → to CPE210 PoE → broadcasts GAID WIFI SERVICES</strong>.
          </p>
          <p>
            The CPE210 / Tenda O3 only broadcasts WiFi — it can't show the sign-in popup or switch internet on and off
            per customer. For that, put a small <strong>MikroTik hotspot router</strong> (e.g. hAP lite / hAP ac²) in
            between:
          </p>
          <div className="space-y-1">
            <Box>Safaricom fibre router (LAN port)</Box>
            <ArrowDown className="mx-auto h-4 w-4 text-primary" />
            <Box accent>MikroTik ether1 (WAN) → Hotspot on ether2</Box>
            <ArrowDown className="mx-auto h-4 w-4 text-primary" />
            <Box>PoE injector (LAN in → PoE out)</Box>
            <ArrowDown className="mx-auto h-4 w-4 text-primary" />
            <Box accent>CPE210 / Tenda O3 — AP mode — SSID “GAID WIFI SERVICES”, open</Box>
          </div>
        </Step>

        <Step n={2} title="Access point (CPE210 / Tenda O3)">
          <p>
            Set <strong>Operation mode: Access Point</strong>, SSID <strong>GAID WIFI SERVICES</strong>, security{" "}
            <strong>None</strong>, and turn off its DHCP server so the MikroTik hands out addresses.
          </p>
        </Step>

        <Step n={3} title="MikroTik hotspot = the auto popup">
          <p>
            In Winbox: <strong>IP → Hotspot → Hotspot Setup</strong> on ether2. Android and iPhone detect the hotspot
            and show <strong>“Sign in to GAID WIFI SERVICES”</strong> automatically.
          </p>
          <p>
            Then in <strong>Files → hotspot/login.html</strong>, replace the content with this so the popup opens the
            GAID WIFI SERVICES portal and passes the phone's MAC:
          </p>
          <Code>{loginHtml}</Code>
          <p>Allow the portal and M-Pesa before login (walled garden), and enable the router API:</p>
          <Code>{mikrotik}</Code>
        </Step>

        <Step n={4} title="Connect the app to the router (optional)">
          <p>
            Until this is set, router control is <strong>simulated</strong>: payments, vouchers and expiry all work in
            the dashboard, but the MikroTik isn't told. To go live, share these with Lovable (stored securely):{" "}
            <strong>MIKROTIK_URL</strong> (e.g. https://xxxx.sn.mynetname.net from IP → Cloud),{" "}
            <strong>MIKROTIK_USER</strong>, <strong>MIKROTIK_PASSWORD</strong>. Paid devices are added as “bypassed”
            and removed when time ends (checked every minute).
          </p>
        </Step>

        <Step n={5} title="M-Pesa (Daraja)">
          <p>
            Without keys, payments run in <strong>test mode</strong> and confirm automatically. For real STK Push, add:{" "}
            <strong>MPESA_CONSUMER_KEY</strong>, <strong>MPESA_CONSUMER_SECRET</strong>, <strong>MPESA_SHORTCODE</strong>,{" "}
            <strong>MPESA_PASSKEY</strong>, and <strong>MPESA_ENV</strong> = sandbox or production. For a Till (Buy
            Goods) also add <strong>MPESA_TILL_NUMBER</strong> and use your store number as the shortcode.
          </p>
          <p>
            Safaricom sends confirmations to <strong>{origin}/api/public/mpesa/callback</strong>. Use your published
            link for real payments — the editor preview link is private.
          </p>
        </Step>

        <Step n={6} title="Test without a router">
          <p>
            Open <strong>{origin}</strong> on your phone, open “Device ID”, type your phone's WiFi MAC (or use a random
            test device), then buy a package or redeem a voucher. Watch it appear in the admin dashboard.
          </p>
          <p>
            Tip: phones use a random MAC per network. Set <strong>Privacy → Use device MAC</strong> for GAID WIFI SERVICES when
            adding devices manually.
          </p>
        </Step>
      </div>
    </main>
  );
}
