// Packages the admin manages, stored in the wifi_packages table.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sortPackages, type WifiPackage } from "@/lib/wifi";

export interface StoredPackage extends WifiPackage {
  visible: boolean;
  removed: boolean;
}

type Row = {
  id: string;
  label: string;
  price: number;
  minutes: number;
  devices: number;
  speed_mbps: number | null;
  visible: boolean;
  removed: boolean;
};

const COLUMNS = "id, label, price, minutes, devices, speed_mbps, visible, removed";

function toPackage(r: Row): StoredPackage {
  return {
    id: r.id,
    label: r.label,
    price: r.price,
    minutes: r.minutes,
    devices: r.devices,
    speedMbps: r.speed_mbps,
    visible: r.visible,
    removed: r.removed,
  };
}

/** Every package ever made, removed ones included (for names on old payments/vouchers). */
export async function listAllPackages(): Promise<StoredPackage[]> {
  const { data, error } = await supabaseAdmin.from("wifi_packages").select(COLUMNS);
  if (error) throw error;
  return sortPackages((data ?? []).map(toPackage));
}

/** Packages customers can see and buy right now. */
export async function listPackagesOnSale(): Promise<WifiPackage[]> {
  const { data, error } = await supabaseAdmin
    .from("wifi_packages")
    .select(COLUMNS)
    .eq("visible", true)
    .eq("removed", false);
  if (error) throw error;
  return sortPackages((data ?? []).map(toPackage)).map(({ visible: _v, removed: _r, ...p }) => p);
}

/**
 * Looks a package up by id.
 * - "sale": only packages customers can buy now (visible, not removed).
 * - "admin": anything not removed (admin may hand out hidden packages).
 * - "any": removed too — used to honour payments/vouchers made before a package was removed.
 */
export async function findStoredPackage(id: string, scope: "sale" | "admin" | "any"): Promise<StoredPackage | null> {
  const { data } = await supabaseAdmin.from("wifi_packages").select(COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const p = toPackage(data);
  if (scope === "sale" && (!p.visible || p.removed)) return null;
  if (scope === "admin" && p.removed) return null;
  return p;
}

/** id -> name, for showing package names next to old records. */
export async function packageLabels(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("wifi_packages").select("id, label");
  return Object.fromEntries((data ?? []).map((r) => [r.id, r.label]));
}
