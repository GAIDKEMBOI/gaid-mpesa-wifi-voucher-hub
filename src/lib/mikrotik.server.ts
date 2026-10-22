// Router control. Simulated by default (the database "users" table is the
// allowed list). Set MIKROTIK_URL, MIKROTIK_USER and MIKROTIK_PASSWORD to drive a
// real MikroTik hotspot through the RouterOS v7 REST API (ip-binding by MAC).

interface RouterConfig {
  url: string;
  auth: string;
}

function getRouterConfig(): RouterConfig | null {
  const url = process.env["MIKROTIK_URL"];
  const user = process.env["MIKROTIK_USER"];
  const pass = process.env["MIKROTIK_PASSWORD"];
  if (!url || !user || !pass) return null;
  return { url: url.replace(/\/$/, ""), auth: `Basic ${btoa(`${user}:${pass}`)}` };
}

export function routerMode(): "mikrotik" | "simulated" {
  return getRouterConfig() ? "mikrotik" : "simulated";
}

async function ros(cfg: RouterConfig, method: string, path: string, body?: unknown) {
  const res = await fetch(`${cfg.url}/rest${path}`, {
    method,
    headers: { Authorization: cfg.auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`RouterOS ${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function setBinding(mac: string, type: "bypassed" | "blocked" | null, comment: string) {
  const cfg = getRouterConfig();
  if (!cfg) {
    console.log(`[router:simulated] ${type ?? "remove"} ${mac} ${comment}`);
    return;
  }
  try {
    const existing = (await ros(cfg, "GET", `/ip/hotspot/ip-binding?mac-address=${encodeURIComponent(mac)}`)) as
      | { ".id": string }[]
      | null;
    for (const b of existing ?? []) {
      await ros(cfg, "DELETE", `/ip/hotspot/ip-binding/${encodeURIComponent(b[".id"])}`);
    }
    if (type) {
      await ros(cfg, "PUT", "/ip/hotspot/ip-binding", { "mac-address": mac, type, comment });
    }
    // Kick any live hotspot session so the change applies immediately
    if (type !== "bypassed") {
      const active = (await ros(cfg, "GET", `/ip/hotspot/active?mac-address=${encodeURIComponent(mac)}`)) as
        | { ".id": string }[]
        | null;
      for (const a of active ?? []) {
        await ros(cfg, "DELETE", `/ip/hotspot/active/${encodeURIComponent(a[".id"])}`);
      }
    }
  } catch (err) {
    // Never block a paid customer because the router is unreachable; the next sweep retries.
    console.error("[router] error", err);
  }
}

export const router = {
  allowMac: (mac: string, expiry: Date) => setBinding(mac, "bypassed", `BRADY until ${expiry.toISOString()}`),
  removeMac: (mac: string) => setBinding(mac, null, "BRADY expired"),
  blockMac: (mac: string) => setBinding(mac, "blocked", "BRADY blocked"),
};
