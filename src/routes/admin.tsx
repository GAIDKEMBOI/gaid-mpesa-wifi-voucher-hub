import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Ban, Copy, Download, Eye, EyeOff, Loader2, LogOut, Plus, Printer, RefreshCw, ShieldCheck, Users, Wallet, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILS_PER_DEVICE,
  PACKAGES,
  adminPasswordProblem,
  formatTimeLeft,
  getPackage,
  type PackageId,
} from "@/lib/wifi";
import {
  addUserManual,
  adminLogin,
  blockMac,
  changeAdminPassword,
  disconnectUser,
  generateVouchers,
  getAdminStatus,
  getDashboard,
  listTransactions,
  listVouchers,
  setupAdmin,
  unblockMac,
} from "@/lib/admin.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — GAID WIFI SERVICES" },
      { name: "description", content: "GAID WIFI SERVICES hotspot admin: active users, M-Pesa collections and vouchers." },
      { property: "og:title", content: "Admin — GAID WIFI SERVICES" },
      { property: "og:description", content: "Manage GAID WIFI SERVICES customers, payments and vouchers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const TOKEN_KEY = "gaid_admin_token";

function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    setReady(true);
  }, []);

  const signIn = (t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  };

  if (!ready) return <div className="min-h-dvh bg-background" />;
  if (!token) return <AuthGate onLogin={signIn} />;
  return (
    <Dashboard
      token={token}
      onToken={signIn}
      onLogout={() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      }}
    />
  );
}

function AuthShell({ subtitle, children, onSubmit }: { subtitle: string; children: React.ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  return (
    <main className="bg-hero flex min-h-dvh items-center justify-center px-4 py-8">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="text-center">
          <h1 className="font-display text-4xl">
            GAID <span className="text-primary">WIFI</span> SERVICES
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </form>
    </main>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        placeholder={placeholder}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="h-12 pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function PasswordHint({ password, username }: { password: string; username?: string }) {
  if (!password) return <p className="text-xs text-muted-foreground">At least {ADMIN_PASSWORD_MIN_LENGTH} characters, with letters and numbers.</p>;
  const problem = adminPasswordProblem(password, username);
  return (
    <p className={cn("flex items-center gap-1 text-xs", problem ? "text-warning" : "text-success")}>
      {problem ? problem : <><ShieldCheck className="h-3.5 w-3.5" /> Strong enough</>}
    </p>
  );
}

function AuthGate({ onLogin }: { onLogin: (t: string) => void }) {
  const statusFn = useServerFn(getAdminStatus);
  const status = useQuery({ queryKey: ["admin-status"], queryFn: () => statusFn() });

  if (status.isLoading) return <div className="bg-hero min-h-dvh" />;
  if (status.error)
    return (
      <AuthShell subtitle="Admin">
        <p className="text-center text-sm text-destructive">Could not reach the server.</p>
        <Button type="button" variant="outline" onClick={() => status.refetch()} className="w-full">
          Try again
        </Button>
      </AuthShell>
    );
  if (!status.data?.setUp) return <Setup onLogin={onLogin} />;
  return <Login onLogin={onLogin} />;
}

function Setup({ onLogin }: { onLogin: (t: string) => void }) {
  const setupFn = useServerFn(setupAdmin);
  const qc = useQueryClient();
  const [username, setUsername] = useState("GAID");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    try {
      const r = await setupFn({ data: { username, password } });
      if (r.ok) {
        toast.success("Admin account created");
        onLogin(r.token);
      } else {
        toast.error(r.error);
        if (/already exists/.test(r.error)) qc.invalidateQueries({ queryKey: ["admin-status"] });
      }
    } catch {
      toast.error("Network problem");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle="Create your admin account (one time)" onSubmit={submit}>
      <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className="h-12" />
      <PasswordInput placeholder="Choose a password" value={password} onChange={setPassword} autoComplete="new-password" />
      <PasswordHint password={password} username={username.trim().toLowerCase()} />
      <PasswordInput placeholder="Type password again" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <Button type="submit" variant="hero" size="xl" disabled={busy || !username || !password || !confirm}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "CREATE ACCOUNT"}
      </Button>
    </AuthShell>
  );
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const loginFn = useServerFn(adminLogin);
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await loginFn({ data: { username, password } });
      if (r.ok) onLogin(r.token);
      else {
        toast.error(r.error);
        if ("needsSetup" in r && r.needsSetup) qc.invalidateQueries({ queryKey: ["admin-status"] });
      }
    } catch {
      toast.error("Network problem");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell subtitle="Admin login" onSubmit={submit}>
      <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" className="h-12" />
      <PasswordInput placeholder="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <Button type="submit" variant="hero" size="xl" disabled={busy || !username || !password}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "LOGIN"}
      </Button>
    </AuthShell>
  );
}

function AccountPanel({ token, onToken, onLogout }: { token: string; onToken: (t: string) => void; onLogout: () => void }) {
  const changeFn = useServerFn(changeAdminPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { toast.error("New passwords do not match"); return; }
    setBusy(true);
    try {
      const r = await changeFn({ data: { token, currentPassword: current, newPassword: next } });
      if (!r.ok) { toast.error(r.error); return; }
      onToken(r.token);
      setCurrent(""); setNext(""); setConfirm("");
      toast.success("Password changed. Other devices have been logged out.");
    } catch (err) {
      if (!handleAuthError(err, onLogout)) toast.error("Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3 rounded-2xl border border-border bg-card p-4">
      <h2 className="font-semibold">Change admin password</h2>
      <PasswordInput placeholder="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordInput placeholder="New password" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordHint password={next} />
      <PasswordInput placeholder="Type new password again" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <Button type="submit" disabled={busy || !current || !next || !confirm}>
        {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Save new password
      </Button>
      <p className="text-xs text-muted-foreground">
        After {LOGIN_MAX_FAILS_PER_DEVICE} wrong tries, login is paused for {LOGIN_LOCK_MINUTES} minutes. Sessions end after 12 hours.
      </p>
    </form>
  );
}

function useTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function handleAuthError(err: unknown, onLogout: () => void) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/log in/i.test(msg)) {
    toast.error(msg);
    onLogout();
    return true;
  }
  return false;
}

function Dashboard({ token, onToken, onLogout }: { token: string; onToken: (t: string) => void; onLogout: () => void }) {
  const qc = useQueryClient();
  const dashFn = useServerFn(getDashboard);
  const txFn = useServerFn(listTransactions);
  const vFn = useServerFn(listVouchers);
  const disconnectFn = useServerFn(disconnectUser);
  const blockFn = useServerFn(blockMac);
  const unblockFn = useServerFn(unblockMac);
  const now = useTick();

  const dash = useQuery({
    queryKey: ["dashboard", token],
    queryFn: () => dashFn({ data: { token } }),
    refetchInterval: 15000,
  });
  const txs = useQuery({
    queryKey: ["transactions", token],
    queryFn: () => txFn({ data: { token } }),
    refetchInterval: 15000,
  });
  const vouchers = useQuery({ queryKey: ["vouchers", token], queryFn: () => vFn({ data: { token } }) });

  useEffect(() => {
    if (dash.error) handleAuthError(dash.error, onLogout);
  }, [dash.error, onLogout]);

  const refresh = () => qc.invalidateQueries();

  async function act(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
      refresh();
    } catch (e) {
      if (!handleAuthError(e, onLogout)) toast.error("Something went wrong");
    }
  }

  const d = dash.data;

  return (
    <main className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="font-display text-2xl">
            GAID <span className="text-primary">WIFI</span> <span className="text-muted-foreground">ADMIN</span>
          </h1>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh">
              <RefreshCw className={cn(dash.isFetching && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut /> Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        {d && (
          <div className="flex flex-wrap gap-2 text-xs">
            <ModeBadge
              label="M-Pesa"
              value={
                d.mpesaMode === "mock"
                  ? `Test mode (missing: ${d.mpesaMissing.map((k) => k.replace("MPESA_", "")).join(", ")})`
                  : d.mpesaMode === "live"
                    ? `Live${d.mpesaTill ? ` · Till ${d.mpesaTill}` : ""}`
                    : "Sandbox"
              }
              warn={d.mpesaMode !== "live"}
            />
            <ModeBadge label="Router" value={d.routerMode === "simulated" ? "Simulated" : "MikroTik"} warn={d.routerMode === "simulated"} />
            <Link to="/setup" className="rounded-full border border-border px-3 py-1 text-primary hover:bg-accent">
              Setup guide →
            </Link>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat icon={<Wifi />} label="Active users now" value={d ? String(d.activeNow) : "—"} />
          <Stat icon={<Wallet />} label="Today collection" value={d ? `KES ${d.collectionToday.toLocaleString()}` : "—"} highlight />
          <Stat icon={<Users />} label="Total users today" value={d ? String(d.usersToday) : "—"} />
        </div>

        <Tabs defaultValue="users">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted p-1">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="add">Add user</TabsTrigger>
            <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
            <TabsTrigger value="mpesa">M-Pesa</TabsTrigger>
            <TabsTrigger value="blocked">Blocked</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Phone</Th>
                  <Th>MAC Address</Th>
                  <Th>Package</Th>
                  <Th>Time Left</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {(d?.sessions ?? []).map((u) => {
                  const left = new Date(u.expiry).getTime() - now;
                  const live = u.status === "active" && left > 0;
                  return (
                    <tr key={u.id} className="border-t border-border">
                      <Td>{u.phone ?? <span className="text-muted-foreground">{u.source}</span>}</Td>
                      <Td className="font-mono text-xs">{u.mac}</Td>
                      <Td>{getPackage(u.package)?.label ?? u.package}</Td>
                      <Td className="tabular-nums">{live ? formatTimeLeft(left) : "—"}</Td>
                      <Td>
                        <StatusPill status={live ? "active" : u.status === "active" ? "expired" : u.status} />
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          {live && (
                            <Button size="sm" variant="outline" onClick={() => act(disconnectFn({ data: { token, mac: u.mac } }), "Disconnected")}>
                              Disconnect
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Block"
                            onClick={() => act(blockFn({ data: { token, mac: u.mac } }), "Device blocked")}
                          >
                            <Ban />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
                {d && d.sessions.length === 0 && <EmptyRow cols={6} text="No customers yet" />}
              </tbody>
            </TableWrap>
          </TabsContent>

          <TabsContent value="add">
            <AddUser token={token} onDone={refresh} onLogout={onLogout} />
          </TabsContent>

          <TabsContent value="vouchers">
            <VoucherPanel token={token} vouchers={vouchers.data ?? []} onDone={refresh} onLogout={onLogout} />
          </TabsContent>

          <TabsContent value="mpesa">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Phone</Th>
                  <Th>Amount</Th>
                  <Th>Package</Th>
                  <Th>M-Pesa Code</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {(txs.data ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <Td className="whitespace-nowrap text-xs">
                      {new Date(t.created_at).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}
                    </Td>
                    <Td>{t.phone}</Td>
                    <Td className="font-semibold">KES {t.amount}</Td>
                    <Td>{getPackage(t.package)?.label ?? t.package}</Td>
                    <Td className="font-mono text-xs">
                      {t.mpesa_code ?? "—"}
                      {t.is_mock && <span className="ml-1 text-muted-foreground">(test)</span>}
                    </Td>
                    <Td>
                      <StatusPill status={t.status} title={t.result_desc ?? undefined} />
                    </Td>
                  </tr>
                ))}
                {txs.data && txs.data.length === 0 && <EmptyRow cols={6} text="No payments yet" />}
              </tbody>
            </TableWrap>
          </TabsContent>

          <TabsContent value="blocked">
            <BlockPanel
              token={token}
              blocked={d?.blocked ?? []}
              onBlock={(mac, reason) => act(blockFn({ data: { token, mac, reason } }), "Device blocked")}
              onUnblock={(mac) => act(unblockFn({ data: { token, mac } }), "Device unblocked")}
            />
          </TabsContent>

          <TabsContent value="account">
            <AccountPanel token={token} onToken={onToken} onLogout={onLogout} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function ModeBadge({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <span className={cn("rounded-full border px-3 py-1", warn ? "border-warning/50 text-warning" : "border-success/50 text-success")}>
      {label}: <strong className="capitalize">{value}</strong>
    </span>
  );
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-2xl border bg-card p-3 shadow-card sm:p-4", highlight ? "border-primary" : "border-border")}>
      <div className="flex items-center gap-1.5 text-xs leading-tight text-muted-foreground sm:text-sm [&_svg]:hidden [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-primary sm:[&_svg]:block">
        {icon} {label}
      </div>
      <div className="font-display mt-1 text-2xl text-foreground sm:text-4xl">{value}</div>
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2.5", className)}>{children}</td>;
}
function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-8 text-center text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

function StatusPill({ status, title }: { status: string; title?: string | undefined }) {
  const tone =
    status === "active" || status === "success"
      ? "bg-success/15 text-success"
      : status === "pending"
        ? "bg-warning/15 text-warning"
        : status === "failed" || status === "cancelled" || status === "disconnected"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span title={title} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", tone)}>
      {status}
    </span>
  );
}

function PackageSelect({ value, onChange }: { value: PackageId; onChange: (v: PackageId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {PACKAGES.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={cn(
            "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
            value === p.id ? "border-primary bg-accent" : "border-border bg-background",
          )}
        >
          <div className="font-semibold">{p.label}</div>
          <div className="text-xs text-muted-foreground">KES {p.price}</div>
        </button>
      ))}
    </div>
  );
}

function AddUser({ token, onDone, onLogout }: { token: string; onDone: () => void; onLogout: () => void }) {
  const addFn = useServerFn(addUserManual);
  const [mac, setMac] = useState("");
  const [phone, setPhone] = useState("");
  const [pkg, setPkg] = useState<PackageId>("1h");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await addFn({ data: { token, mac, phone: phone || undefined, packageId: pkg } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`Online until ${new Date(r.expiry).toLocaleString("en-KE")}`);
      setMac("");
      setPhone("");
      onDone();
    } catch (err) {
      if (!handleAuthError(err, onLogout)) toast.error("Check the MAC address and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">Give internet to a device by its MAC address (cash customers, staff, testing).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="MAC e.g. A1:B2:C3:D4:E5:F6" value={mac} onChange={(e) => setMac(e.target.value)} className="h-11 font-mono" />
        <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" />
      </div>
      <PackageSelect value={pkg} onChange={setPkg} />
      <Button type="submit" disabled={busy || mac.length < 12}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />} Add user
      </Button>
    </form>
  );
}

type VoucherRow = { id: string; code: string; package: string; used: boolean; used_by_mac: string | null; batch: string | null; created_at: string };

function VoucherPanel({
  token,
  vouchers,
  onDone,
  onLogout,
}: {
  token: string;
  vouchers: VoucherRow[];
  onDone: () => void;
  onLogout: () => void;
}) {
  const genFn = useServerFn(generateVouchers);
  const [pkg, setPkg] = useState<PackageId>("1h");
  const [count, setCount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ codes: string[]; pkg: PackageId } | null>(null);
  const unused = useMemo(() => vouchers.filter((v) => !v.used).length, [vouchers]);

  async function generate() {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 500) { toast.error("Choose between 1 and 500 codes"); return; }
    setBusy(true);
    try {
      const r = await genFn({ data: { token, packageId: pkg, count: n } });
      if (!r.ok) { toast.error(r.error); return; }
      setFresh({ codes: r.codes, pkg });
      toast.success(`${r.codes.length} vouchers created`);
      onDone();
    } catch (err) {
      if (!handleAuthError(err, onLogout)) toast.error("Could not create vouchers");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv(codes: string[], p: string) {
    const csv = "code,package\n" + codes.map((c) => `${c},${p}`).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `gaid-vouchers-${p}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 print:hidden">
        <PackageSelect value={pkg} onChange={setPkg} />
        <div className="flex gap-2">
          <Input type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} className="h-10 w-28" />
          <Button onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Generate codes
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {vouchers.length} total · {unused} unused
        </p>
      </div>

      {fresh && (
        <div className="rounded-2xl border border-primary bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
            <strong className="mr-auto">
              {fresh.codes.length} × {getPackage(fresh.pkg)?.label}
            </strong>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(fresh.codes.join("\n")).then(() => toast.success("Copied"))}>
              <Copy /> Copy
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadCsv(fresh.codes, fresh.pkg)}>
              <Download /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {fresh.codes.map((c) => (
              <div key={c} className="rounded-lg border border-dashed border-border p-2 text-center">
                <div className="font-display text-xs text-primary">GAID WIFI SERVICES · {getPackage(fresh.pkg)?.label}</div>
                <div className="font-mono text-lg tracking-widest">{c}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="print:hidden">
        <TableWrap>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Package</Th>
              <Th>Status</Th>
              <Th>Used by</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {vouchers.slice(0, 300).map((v) => (
              <tr key={v.id} className="border-t border-border">
                <Td className="font-mono">{v.code}</Td>
                <Td>{getPackage(v.package)?.label ?? v.package}</Td>
                <Td>
                  <StatusPill status={v.used ? "used" : "active"} />
                </Td>
                <Td className="font-mono text-xs">{v.used_by_mac ?? "—"}</Td>
                <Td className="text-xs">{new Date(v.created_at).toLocaleDateString("en-KE")}</Td>
              </tr>
            ))}
            {vouchers.length === 0 && <EmptyRow cols={5} text="No vouchers yet" />}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}

function BlockPanel({
  blocked,
  onBlock,
  onUnblock,
}: {
  token: string;
  blocked: { mac: string; reason: string | null; created_at: string }[];
  onBlock: (mac: string, reason?: string) => void;
  onUnblock: (mac: string) => void;
}) {
  const [mac, setMac] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onBlock(mac, reason || undefined);
          setMac("");
          setReason("");
        }}
        className="grid gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]"
      >
        <Input placeholder="MAC to block" value={mac} onChange={(e) => setMac(e.target.value)} className="font-mono" />
        <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" variant="destructive" disabled={mac.length < 12}>
          <Ban /> Block
        </Button>
      </form>
      <TableWrap>
        <thead>
          <tr>
            <Th>MAC Address</Th>
            <Th>Reason</Th>
            <Th>Blocked on</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {blocked.map((b) => (
            <tr key={b.mac} className="border-t border-border">
              <Td className="font-mono text-xs">{b.mac}</Td>
              <Td>{b.reason ?? "—"}</Td>
              <Td className="text-xs">{new Date(b.created_at).toLocaleString("en-KE")}</Td>
              <Td>
                <Button size="sm" variant="outline" onClick={() => onUnblock(b.mac)}>
                  Unblock
                </Button>
              </Td>
            </tr>
          ))}
          {blocked.length === 0 && <EmptyRow cols={4} text="No blocked devices" />}
        </tbody>
      </TableWrap>
    </div>
  );
}
