import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Gift, Loader2, LogOut, RefreshCw, Smartphone, Wifi, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FREE_WIFI_END_HOUR,
  FREE_WIFI_START_HOUR,
  OTP_LENGTH,
  PACKAGES,
  formatTimeLeft,
  greeting,
  normalizeMac,
  packageLine,
  type WifiPackage,
} from "@/lib/wifi";
import { checkPayment, getAccessStatus, redeemVoucher } from "@/lib/portal.functions";
import {
  buyPackage,
  claimFreeWifiNow,
  getMyAccount,
  requestSignInCode,
  useDeviceSlot,
  verifySignInCode,
} from "@/lib/customer.functions";
import { cn } from "@/lib/utils";

interface PortalSearch {
  mac?: string | undefined;
  ip?: string | undefined;
  "link-orig"?: string | undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): PortalSearch => ({
    mac: typeof s["mac"] === "string" ? s["mac"] : undefined,
    ip: typeof s["ip"] === "string" ? s["ip"] : undefined,
    "link-orig": typeof s["link-orig"] === "string" ? (s["link-orig"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in to GAID WIFI SERVICES — Fast & Affordable" },
      {
        name: "description",
        content: "Get online with GAID WIFI SERVICES. 30 minutes from Sh5. Prepaid credit, M-Pesa and free WiFi 6-8 AM daily.",
      },
      { property: "og:title", content: "GAID WIFI SERVICES — Fast & Affordable" },
      { property: "og:description", content: "Sh5 = 30 Mins · Sh45 = 24 Hours · 2-device packages · Free WiFi Kila Siku 6-8 AM" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Portal,
});

const MAC_KEY = "gaid_mac";
const TXN_KEY = "gaid_txn";
const CUST_KEY = "gaid_customer";

type Stage = "home" | "paying" | "failed";
type Offer = "all" | "one" | "multi";

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Portal() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const statusFn = useServerFn(getAccessStatus);
  const checkFn = useServerFn(checkPayment);
  const voucherFn = useServerFn(redeemVoucher);
  const accountFn = useServerFn(getMyAccount);
  const buyFn = useServerFn(buyPackage);
  const slotFn = useServerFn(useDeviceSlot);
  const freeFn = useServerFn(claimFreeWifiNow);

  const [hydrated, setHydrated] = useState(false);
  const [mac, setMac] = useState<string | null>(null);
  const [fromRouter, setFromRouter] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [stage, setStage] = useState<Stage>("home");
  const [txnId, setTxnId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [mock, setMock] = useState(false);
  const [failMsg, setFailMsg] = useState("");
  const [deviceExpiry, setDeviceExpiry] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const now = useNow();

  useEffect(() => {
    const fromUrl = search.mac ? normalizeMac(search.mac) : null;
    if (fromUrl) {
      setMac(fromUrl);
      setFromRouter(true);
      localStorage.setItem(MAC_KEY, fromUrl);
    } else {
      const saved = localStorage.getItem(MAC_KEY);
      if (saved && normalizeMac(saved)) setMac(normalizeMac(saved));
    }
    setToken(localStorage.getItem(CUST_KEY));
    setHost(window.location.host);
    const pending = sessionStorage.getItem(TXN_KEY);
    if (pending) {
      setTxnId(pending);
      setStage("paying");
    }
    setHydrated(true);
  }, [search.mac]);

  const signOut = useCallback(() => {
    localStorage.removeItem(CUST_KEY);
    setToken(null);
    qc.removeQueries({ queryKey: ["account"] });
  }, [qc]);

  const account = useQuery({
    queryKey: ["account", token, mac],
    queryFn: () => accountFn({ data: { token: token!, mac } }),
    enabled: Boolean(token),
    refetchInterval: 30_000,
    retry: false,
  });
  useEffect(() => {
    if (account.error) {
      signOut();
      toast.error("Please sign in again");
    }
  }, [account.error, signOut]);

  // Is this device already online? (works signed in or not)
  useEffect(() => {
    if (!mac) return;
    statusFn({ data: { mac } })
      .then((s) => {
        setBlocked(s.blocked);
        setDeviceExpiry(s.online ? s.expiry : null);
      })
      .catch(() => {});
  }, [mac, statusFn, account.dataUpdatedAt]);

  const acc = account.data;
  const onlineUntil = acc?.device?.expiry ?? deviceExpiry;
  const onlineLeft = onlineUntil ? new Date(onlineUntil).getTime() - now : 0;

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    if (stage !== "paying" || !txnId) return;
    const tick = async () => {
      try {
        const r = await checkFn({ data: { transactionId: txnId } });
        if (r.status === "success") {
          stopPolling();
          sessionStorage.removeItem(TXN_KEY);
          setDeviceExpiry(r.expiry);
          setStage("home");
          toast.success("Payment received. You are online!");
          void qc.invalidateQueries({ queryKey: ["account"] });
        } else if (r.status === "failed" || r.status === "cancelled") {
          stopPolling();
          sessionStorage.removeItem(TXN_KEY);
          setFailMsg(r.message || "Payment was not completed.");
          setStage("failed");
        }
      } catch {
        /* keep polling */
      }
    };
    pollRef.current = setInterval(tick, 3000);
    void tick();
    return stopPolling;
  }, [stage, txnId, checkFn, stopPolling, qc]);

  function needDevice(): string | null {
    if (!mac) {
      toast.error("Device not detected yet. Enter the device ID at the bottom of the page.");
      return null;
    }
    return mac;
  }

  async function buy(p: WifiPackage) {
    if (!token) {
      document.getElementById("signin")?.scrollIntoView({ behavior: "smooth" });
      toast.info("Sign in with your phone number first");
      return;
    }
    const m = needDevice();
    if (!m) return;
    setBusy(p.id);
    try {
      const r = await buyFn({ data: { token, mac: m, packageId: p.id } });
      if (!r.ok) return void toast.error(r.error);
      if (r.paid === "credit") {
        setDeviceExpiry(r.expiry);
        toast.success(`${p.label} started. You are online!`);
        void qc.invalidateQueries({ queryKey: ["account"] });
      } else {
        sessionStorage.setItem(TXN_KEY, r.transactionId);
        setPayAmount(r.amount);
        setMock(r.mock);
        setTxnId(r.transactionId);
        setStage("paying");
      }
    } catch {
      toast.error("Network problem. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string; expiry?: string }>, ok: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Something went wrong");
      if (r.expiry) setDeviceExpiry(r.expiry);
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ["account"] });
    } catch {
      toast.error("Network problem. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const continueUrl = search["link-orig"] || "https://www.google.com";

  return (
    <main className="min-h-dvh bg-hero">
      <div className="border-b border-border bg-card/80 px-4 py-2.5 text-center text-sm backdrop-blur">
        <span className="font-semibold text-foreground">Sign in to GAID</span>
        {host && <span className="ml-1.5 text-muted-foreground">{host}</span>}
      </div>

      <div className="mx-auto flex min-h-[calc(100dvh-41px)] w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5">
        <header className="text-center">
          <h1 className="font-display text-4xl leading-none text-foreground">
            GAID <span className="text-primary">WIFI</span> SERVICES
          </h1>
          <p className="font-display mt-1 text-base tracking-[0.2em] text-muted-foreground">FAST & AFFORDABLE</p>
        </header>

        {blocked && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-center text-sm">
            This device has been blocked. Please contact the GAID WIFI SERVICES admin.
          </div>
        )}

        {stage === "paying" && (
          <section className="rounded-2xl border border-primary/40 bg-card p-6 text-center shadow-card">
            <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-primary/40" />
              <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Smartphone className="h-10 w-10" />
              </span>
            </div>
            <h2 className="font-display mt-5 text-3xl">Enter M-Pesa PIN on your phone</h2>
            <p className="mt-2 text-muted-foreground">
              Pay <strong className="text-foreground">Sh{payAmount || "…"}</strong>. It goes into your credit and your
              package starts as soon as the payment arrives.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for confirmation…
            </div>
            {mock && (
              <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Test mode: no real money is charged. Payment confirms automatically in a few seconds.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                stopPolling();
                sessionStorage.removeItem(TXN_KEY);
                setStage("home");
              }}
              className="mt-5 text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Cancel
            </button>
          </section>
        )}

        {stage === "failed" && (
          <section className="rounded-2xl border border-destructive/40 bg-card p-6 text-center shadow-card">
            <XCircle className="mx-auto h-14 w-14 text-destructive" />
            <h2 className="font-display mt-3 text-3xl">Payment not completed</h2>
            <p className="mt-2 text-muted-foreground">{failMsg}</p>
            <Button variant="hero" size="xl" className="mt-6" onClick={() => setStage("home")}>
              TRY AGAIN
            </Button>
          </section>
        )}

        {stage === "home" && (
          <>
            {onlineUntil && onlineLeft > 0 && (
              <section className="rounded-2xl border border-success/40 bg-card p-4 text-center shadow-card">
                <div className="flex items-center justify-center gap-2 text-success">
                  <CheckCircle2 className="h-6 w-6" />
                  <span className="font-display text-2xl">You are online!</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Time left: <span className="font-display text-2xl tabular-nums text-foreground">{formatTimeLeft(onlineLeft)}</span>
                </p>
                <Button asChild variant="success" size="lg" className="mt-3 w-full">
                  <a href={continueUrl}>Start browsing</a>
                </Button>
              </section>
            )}

            {hydrated && !token && <SignIn onSignedIn={(t) => { localStorage.setItem(CUST_KEY, t); setToken(t); }} />}

            {token && !acc && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}

            {token && acc && (
              <>
                <div className="flex items-end justify-between">
                  <h2 className="text-2xl font-bold">
                    {greeting(new Date(now))}, {acc.name || "Customer"} <span aria-hidden>👋</span>
                  </h2>
                  <button type="button" onClick={signOut} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>

                <section className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">
                      Prepaid: <span className="font-semibold text-foreground">0{acc.phone.slice(3)}</span>
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">Credit (Ksh)</div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-4xl tabular-nums text-success">{acc.credit.toFixed(2)}</span>
                      <button
                        type="button"
                        aria-label="Refresh credit"
                        onClick={() => void account.refetch()}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <RefreshCw className={cn("h-4 w-4", account.isFetching && "animate-spin")} />
                      </button>
                    </div>
                  </div>
                  <div className="border-l border-border pl-3 text-right">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Net Points</div>
                    <div className="font-display text-3xl tabular-nums text-primary">{acc.netPoints}</div>
                  </div>
                </section>

                <section className="flex items-center gap-3 rounded-2xl bg-primary p-4 text-primary-foreground shadow-glow">
                  <Gift className="h-8 w-8 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-xl leading-tight">
                      Free WiFi Kila Siku {FREE_WIFI_START_HOUR}:00-{FREE_WIFI_END_HOUR}:00 AM
                    </div>
                    <div className="text-xs opacity-80">
                      {acc.freeWifi.claimedToday
                        ? "You've used today's free WiFi. See you tomorrow!"
                        : acc.freeWifi.now
                          ? "It's free right now. Tap to connect."
                          : "Come back tomorrow morning to browse free."}
                    </div>
                  </div>
                  {acc.freeWifi.now && !acc.freeWifi.claimedToday && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy === "free"}
                      onClick={() => {
                        const m = needDevice();
                        if (m) void run("free", () => freeFn({ data: { token, mac: m } }), "Free WiFi is on until 8:00 AM");
                      }}
                    >
                      {busy === "free" ? <Loader2 className="animate-spin" /> : "CONNECT"}
                    </Button>
                  )}
                </section>

                <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
                  <h3 className="font-semibold">Your Active Subscriptions</h3>
                  {acc.subscriptions.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">No active subscriptions</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {acc.subscriptions.map((s) => {
                        const left = new Date(s.expiry).getTime() - now;
                        return (
                          <li key={s.id} className="rounded-xl border border-success/30 bg-success/5 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold">{s.label}</span>
                              <span className="font-display text-xl tabular-nums text-success">{formatTimeLeft(left)}</span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>
                                {s.slots} slot{s.slots > 1 ? "s" : ""} - {s.used} used
                                {s.thisDevice && " · this device"}
                              </span>
                              {!s.thisDevice && s.used < s.slots && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  disabled={busy === s.id}
                                  onClick={() => {
                                    const m = needDevice();
                                    if (m) void run(s.id, () => slotFn({ data: { token, mac: m, subscriptionId: s.id } }), "This device is now online");
                                  }}
                                >
                                  {busy === s.id ? <Loader2 className="animate-spin" /> : "Use on this device"}
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}

            <VoucherBox
              busy={busy === "voucher"}
              disabled={blocked}
              onRedeem={(code) => {
                const m = needDevice();
                if (m) void run("voucher", () => voucherFn({ data: { code, mac: m } }), "Voucher accepted. You are online!");
              }}
            />

            <Offers busy={busy} disabled={blocked} onBuy={buy} />
          </>
        )}

        {!fromRouter && hydrated && (
          <DeviceId
            mac={mac}
            onSave={(m) => {
              setMac(m);
              localStorage.setItem(MAC_KEY, m);
            }}
          />
        )}

        <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
          © GAID WIFI SERVICES · Powered by Lipa na M-Pesa
        </footer>
      </div>
    </main>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const requestFn = useServerFn(requestSignInCode);
  const verifyFn = useServerFn(verifySignInCode);
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [testCode, setTestCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const r = await requestFn({ data: { phone } });
      if (!r.ok) return void toast.error(r.error);
      setSentTo(r.phone);
      setTestCode(r.testCode);
      setCode("");
    } catch {
      toast.error("Network problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!sentTo) return;
    setBusy(true);
    try {
      const r = await verifyFn({ data: { phone: sentTo, code, name: name || undefined } });
      if (!r.ok) return void toast.error(r.error);
      onSignedIn(r.token);
    } catch {
      toast.error("Network problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="signin" className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <h2 className="font-display text-2xl">Sign in with your phone</h2>
      {!sentTo ? (
        <div className="mt-3 space-y-3">
          <Input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="07XX XXX XXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-14 rounded-xl text-xl tracking-wider"
            aria-label="Phone number"
          />
          <Button variant="hero" size="xl" onClick={send} disabled={busy || phone.length < 9}>
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : "SEND CODE"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">We'll send a {OTP_LENGTH}-digit code by SMS.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Code sent to <strong className="text-foreground">0{sentTo.slice(3)}</strong>.{" "}
            <button type="button" className="text-primary hover:underline" onClick={() => setSentTo(null)}>
              Change
            </button>
          </p>
          {testCode && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Test mode (SMS not set up yet): your code is <strong className="font-mono text-foreground">{testCode}</strong>
            </p>
          )}
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Enter code"
            maxLength={OTP_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-14 rounded-xl text-center font-mono text-2xl tracking-[0.4em]"
            aria-label="Sign-in code"
          />
          <Input
            placeholder="Your name (optional)"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-xl"
            aria-label="Your name"
          />
          <Button variant="hero" size="xl" onClick={verify} disabled={busy || code.length !== OTP_LENGTH}>
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : "SIGN IN"}
          </Button>
          <button type="button" onClick={send} disabled={busy} className="w-full text-center text-xs text-primary hover:underline">
            Send a new code
          </button>
        </div>
      )}
    </section>
  );
}

function VoucherBox({ busy, disabled, onRedeem }: { busy: boolean; disabled: boolean; onRedeem: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <section className="flex gap-2">
      <Input
        placeholder="Enter Voucher Code"
        value={code}
        autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        className="h-12 flex-1 rounded-xl font-mono tracking-widest"
        aria-label="Voucher code"
      />
      <Button variant="hero" className="h-12 w-auto px-5" disabled={busy || disabled || code.length < 4} onClick={() => onRedeem(code)}>
        {busy ? <Loader2 className="animate-spin" /> : "CONNECT"}
      </Button>
    </section>
  );
}

function Offers({ busy, disabled, onBuy }: { busy: string | null; disabled: boolean; onBuy: (p: WifiPackage) => void }) {
  const [offer, setOffer] = useState<Offer>("all");
  const tabs: { id: Offer; label: string }[] = [
    { id: "all", label: "All" },
    { id: "one", label: "1 Device" },
    { id: "multi", label: "2+ Devices" },
  ];
  const list = PACKAGES.filter((p) => offer === "all" || (offer === "one" ? p.devices === 1 : p.devices > 1));
  return (
    <section>
      <h3 className="mb-2 font-semibold">Offers</h3>
      <div className="mb-3 grid grid-cols-3 rounded-xl bg-muted p-1 text-sm font-semibold">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOffer(t.id)}
            aria-pressed={offer === t.id}
            className={cn(
              "rounded-lg py-2 transition-colors",
              offer === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card">
            <span className="font-display flex h-14 w-16 shrink-0 items-center justify-center rounded-xl bg-primary text-2xl text-primary-foreground">
              Sh{p.price}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-snug">{packageLine(p)}</div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Wifi className="h-3 w-3" />
                {p.devices} Device{p.devices > 1 ? "(s)" : ""}
                {p.speedMbps ? ` · ${p.speedMbps} Mbps` : ""}
              </div>
            </div>
            <Button size="sm" variant="hero" className="h-9 w-auto px-4" disabled={disabled || busy === p.id} onClick={() => onBuy(p)}>
              {busy === p.id ? <Loader2 className="animate-spin" /> : "BUY"}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        BUY uses your credit. If it's not enough, you get an M-Pesa prompt for the difference.
      </p>
    </section>
  );
}

function DeviceId({ mac, onSave }: { mac: string | null; onSave: (mac: string) => void }) {
  const [input, setInput] = useState("");
  function save(value: string) {
    const m = normalizeMac(value);
    if (!m) return void toast.error("That doesn't look like a MAC address (e.g. A1:B2:C3:D4:E5:F6)");
    onSave(m);
  }
  function random() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    bytes[0] = ((bytes[0] ?? 0) | 0x02) & 0xfe; // locally administered
    save(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(":"));
  }
  return (
    <details className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm" open={!mac}>
      <summary className="cursor-pointer font-semibold text-muted-foreground">
        Device ID {mac ? <span className="font-mono text-foreground">· {mac}</span> : "(testing)"}
      </summary>
      <p className="mt-2 text-muted-foreground">
        On the hotspot your device is detected automatically. For testing, enter this phone's WiFi MAC address
        (Settings → WiFi → GAID WIFI SERVICES → Advanced).
      </p>
      <div className="mt-3 flex gap-2">
        <Input placeholder="A1:B2:C3:D4:E5:F6" value={input} onChange={(e) => setInput(e.target.value)} className="font-mono" />
        <Button variant="secondary" onClick={() => save(input)}>
          Save
        </Button>
      </div>
      <button type="button" onClick={random} className="mt-2 text-xs text-primary hover:underline">
        Use a random test device
      </button>
    </details>
  );
}
