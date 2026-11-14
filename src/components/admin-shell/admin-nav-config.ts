import {
  BellRingIcon,
  Building2Icon,
  CoinsIcon,
  CreditCardIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export type AdminNavKey =
  | "overview"
  | "organizations"
  | "subscriptions"
  | "usage"
  | "costs"
  | "audit"
  | "alerts"
  | "settings";

export type AdminSectionKey = Exclude<AdminNavKey, "overview">;

export interface AdminNavItem {
  key: AdminNavKey;
  href: string;
  icon: LucideIcon;
}

/** Super Admin sidebar — independent from the customer `/app` navigation. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: "overview", href: "/admin", icon: LayoutDashboardIcon },
  { key: "organizations", href: "/admin/organizations", icon: Building2Icon },
  { key: "subscriptions", href: "/admin/subscriptions", icon: CreditCardIcon },
  { key: "usage", href: "/admin/usage", icon: GaugeIcon },
  { key: "costs", href: "/admin/costs", icon: CoinsIcon },
  { key: "audit", href: "/admin/audit", icon: ScrollTextIcon },
  { key: "alerts", href: "/admin/alerts", icon: BellRingIcon },
  { key: "settings", href: "/admin/settings", icon: SettingsIcon },
];

export function getAdminNavItem(key: AdminNavKey): AdminNavItem {
  const item = ADMIN_NAV.find((i) => i.key === key);
  if (!item) throw new Error(`Unknown admin nav key: ${key}`);
  return item;
}
