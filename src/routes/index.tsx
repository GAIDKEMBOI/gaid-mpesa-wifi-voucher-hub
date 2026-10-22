import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Smartphone, Ticket, Wifi, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PACKAGES, formatTimeLeft, getPackage, normalizeMac, type PackageId } from "@/lib/wifi";
import {
  checkPayment,
  getAccessStatus,
  getPortalInfo,
  redeemVoucher,
  startPayment,
} from "@/lib/portal.functions";
import { cn } from "@/lib/utils";

interface PortalSearch {
  mac?: string;
  ip?: string;
  "link-orig"?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): PortalSearch => ({
    mac: typeof s.mac === "string" ? s.mac : undefined,
    ip: typeof s.ip === "string" ? s.ip : undefined,
    "link-orig": typeof s["link-orig"] === "string" ? (s["link-orig"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in to BRADY WIFI — Fast & Affordable" },
      {
        name: "description",
        content: "Get online with BRADY WIFI. 1 hour from KES 20. Pay instantly with Lipa na M-Pesa.",
      },
      { property: "og:title", content: "BRADY WIFI — Fast & Affordable" },
      { property: "og:description", content: "1 Hour KES 20 · 6 Hours KES 50 · 24 Hours KES 100 · 7 Days KES 500" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Portal,
});

const MAC_KEY = "brady_mac";
const TXN_KEY = "brady_txn";

type Stage = "choose" | "paying" | "online" | "failed";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function Portal() {
  const search = Route.useSearch();
  const statusFn = useServerFn(getAccessStatus);
  const payFn = useServerFn(startPayment);
  const checkFn = useServerFn(checkPayment);
  const voucherFn = useServerFn(redeemVoucher);
  const infoFn = useServerFn(getPortalInfo);

  const [mac, setMac] = useState<string | null>(null);
  const [macInput, setMacInput] = useState("");
  const [fromRouter, setFromRouter] = useState(false);
  const [mode, setMode] = useState<"mpesa" | "voucher">("mpesa");
  const [pkgId, setPkgId] = useState<PackageId>("24h");
  const [phone, setPhone] = useState("");
  const [voucher, setVoucher] = useState("");
  const [stage, setStage] = useState<Stage>("choose");
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [failMsg, setFailMsg] = useState("");
  const [txnId, setTxnId] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const now = useNow(stage === "online");
  const msLeft = expiry ? new Date(expiry).getTime() - now : 0;

  // Device ID: from the router redirect, else remembered on this phone
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
    infoFn().then((i) => setMock(i.mpesaMode === "mock")).catch(() => {});
  }, [search.mac, infoFn]);

  // Already online? Or a payment in progress?
  useEffect(() => {
    if (!mac) return;
    statusFn({ data: { mac } })
      .then((s) => {
        setBlocked(s.blocked);
        if (s.online && s.expiry) {
          setExpiry(s.expiry);
          setStage("online");
        } else {
          const pending = sessionStorage.getItem(TXN_KEY);
          if (pending) {
            setTxnId(pending);
            setStage("paying");
          }
        }
      })
      .catch(() => {});
  }, [mac, statusFn]);

  useEffect(() => {
    if (stage === "online" && expiry && msLeft <= 0) {
      setStage("choose");
      setExpiry(null);
      toast.info("Your package has ended. Buy a new one to continue.");
    }
  }, [stage, expiry, msLeft]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  // Poll payment status while waiting for the PIN
  useEffect(() => {
    if (stage !== "paying" || !txnId) return;
    const tick = async () => {
      try {
        const r = await checkFn({ data: { transactionId: txnId } });
        if (r.status === "success") {
          stopPolling();
          sessionStorage.removeItem(TXN_KEY);
          setExpiry(r.expiry);
          setStage("online");
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
  }, [stage, txnId, checkFn, stopPolling]);

  function saveMac(value: string) {
    const m = normalizeMac(value);
    if (!m) {
      toast.error("That doesn't look like a MAC address (e.g. A1:B2:C3:D4:E5:F6)");
      return;
    }
    setMac(m);
    localStorage.setItem(MAC_KEY, m);
  }

  function useTestDevice() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    bytes[0] = (bytes[0] | 0x02) & 0xfe; // locally administered
    saveMac(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(":"));
  }

  async function pay() {
    if (!mac) return toast.error("Device not detected yet. Enter the device MAC below.");
    setBusy(true);
    try {
      const r = await payFn({ data: { phone, mac, packageId: pkgId } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      sessionStorage.setItem(TXN_KEY, r.transactionId);
      setMock(r.mock);
      setTxnId(r.transactionId);
      setStage("paying");
    } catch {
      toast.error("Network problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!mac) return toast.error("Device not detected yet. Enter the device MAC below.");
    setBusy(true);
    try {
      const r = await voucherFn({ data: { code: voucher, mac } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setExpiry(r.expiry);
      setStage("online");
    } catch {
      toast.error("Network problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const selected = getPackage(pkgId)!;
  const continueUrl = search["link-orig"] || "https://www.google.com";

  return (
    <main className="bg-hero min-h-dvh">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-6">
        <header className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
            <Wifi className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-5xl leading-none text-foreground">
            BRADY <span className="text-primary">WIFI</span>
          </h1>
          <p className="font-display mt-1 text-xl tracking-[0.2em] text-muted-foreground">
            FAST & AFFORDABLE
          </p>
        </header>

        {blocked && (
          <div className="mb-4 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-center text-sm">
            This device has been blocked. Please contact the BRADY WIFI admin.
          </div>
        )}

        {stage === "online" && expiry && (
          <section className="rounded-2xl border border-success/40 bg-card p-6 text-center shadow-card">
            <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
            <h2 className="font-display mt-3 text-4xl text-success">You are online!</h2>
            <p className="mt-4 text-sm uppercase tracking-widest text-muted-foreground">Time left</p>
            <p className="font-display text-6xl tabular-nums text-foreground">{formatTimeLeft(msLeft)}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Expires {new Date(expiry).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <Button asChild variant="success" size="xl" className="mt-6 text-lg">
              <a href={continueUrl}>Start browsing</a>
            </Button>
            <button
              type="button"
              onClick={() => setStage("choose")}
              className="mt-4 text-sm text-primary underline-offset-4 hover:underline"
            >
              Add more time
            </button>
          </section>
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
              Check your phone for the M-Pesa prompt and enter your PIN to pay{" "}
              <strong className="text-foreground">KES {selected.price}</strong>.
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
                setStage("choose");
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
            <Button variant="hero" size="xl" className="mt-6" onClick={() => setStage("choose")}>
              TRY AGAIN
            </Button>
          </section>
        )}

        {stage === "choose" && (
          <>
            <div className="mb-4 grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setMode("mpesa")}
                className={cn(
                  "rounded-lg py-2.5 transition-colors",
                  mode === "mpesa" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                Buy package
              </button>
              <button
                type="button"
                onClick={() => setMode("voucher")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-2.5 transition-colors",
                  mode === "voucher" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Ticket className="h-4 w-4" /> I have voucher
              </button>
            </div>

            {mode === "mpesa" ? (
              <section className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {PACKAGES.map((p) => {
                    const active = p.id === pkgId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPkgId(p.id)}
                        aria-pressed={active}
                        className={cn(
                          "rounded-2xl border bg-card p-4 text-left shadow-card transition-all active:scale-[0.98]",
                          active ? "border-primary shadow-glow" : "border-border",
                        )}
                      >
                        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          {p.label}
                        </div>
                        <div className="font-display mt-1 text-4xl leading-none text-foreground">
                          <span className="text-lg text-primary">KES </span>
                          {p.price}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">M-Pesa phone number</span>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="07XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-14 rounded-xl text-xl tracking-wider"
                  />
                </label>

                <Button variant="hero" size="xl" onClick={pay} disabled={busy || blocked || phone.length < 9}>
                  {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : `LIPA NA MPESA · KES ${selected.price}`}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  You will get an M-Pesa prompt on your phone. Internet starts immediately after payment.
                </p>
              </section>
            ) : (
              <section className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Voucher code</span>
                  <Input
                    placeholder="e.g. K7M2QX9P"
                    value={voucher}
                    autoCapitalize="characters"
                    onChange={(e) => setVoucher(e.target.value.toUpperCase())}
                    className="h-14 rounded-xl text-center font-mono text-2xl tracking-[0.3em]"
                  />
                </label>
                <Button variant="hero" size="xl" onClick={redeem} disabled={busy || blocked || voucher.length < 4}>
                  {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : "CONNECT"}
                </Button>
              </section>
            )}
          </>
        )}

        {!fromRouter && (
          <details className="mt-8 rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm" open={!mac}>
            <summary className="cursor-pointer font-semibold text-muted-foreground">
              Device ID {mac ? <span className="font-mono text-foreground">· {mac}</span> : "(testing)"}
            </summary>
            <p className="mt-2 text-muted-foreground">
              On the hotspot your device is detected automatically. For testing, enter this phone's WiFi MAC
              address (Settings → WiFi → BRADY WIFI → Advanced).
            </p>
            <div className="mt-3 flex gap-2">
              <Input
                placeholder="A1:B2:C3:D4:E5:F6"
                value={macInput}
                onChange={(e) => setMacInput(e.target.value)}
                className="font-mono"
              />
              <Button variant="secondary" onClick={() => saveMac(macInput)}>
                Save
              </Button>
            </div>
            <button type="button" onClick={useTestDevice} className="mt-2 text-xs text-primary hover:underline">
              Use a random test device
            </button>
          </details>
        )}

        <footer className="mt-auto pt-8 text-center text-xs text-muted-foreground">
          © BRADY WIFI · Powered by Lipa na M-Pesa
        </footer>
      </div>
    </main>
  );
}
