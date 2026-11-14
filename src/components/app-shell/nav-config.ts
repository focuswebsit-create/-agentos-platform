import {
  BarChart3Icon,
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  PlayCircleIcon,
  PlugIcon,
  SettingsIcon,
  UsersIcon,
  UsersRoundIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

export type AppNavKey =
  | "dashboard"
  | "agents"
  | "teams"
  | "workflows"
  | "templates"
  | "runs"
  | "knowledge"
  | "integrations"
  | "approvals"
  | "analytics"
  | "billing"
  | "team"
  | "settings";

export type AppSectionKey = Exclude<AppNavKey, "dashboard">;

export type NavGroup = "build" | "operate" | "account";

export interface AppNavItem {
  key: AppNavKey;
  href: string;
  icon: LucideIcon;
  group: NavGroup | null;
  /** Roadmap phase in which the screen becomes functional. */
  phase: "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | null;
}

/** Customer workspace sidebar (UI_UX_SPEC.md "Customer workspace sidebar"). */
export const APP_NAV: readonly AppNavItem[] = [
  { key: "dashboard", href: "/app", icon: LayoutDashboardIcon, group: null, phase: null },
  { key: "agents", href: "/app/agents", icon: BotIcon, group: "build", phase: null },
  { key: "teams", href: "/app/teams", icon: UsersRoundIcon, group: "build", phase: "P4" },
  { key: "workflows", href: "/app/workflows", icon: WorkflowIcon, group: "build", phase: "P4" },
  {
    key: "templates",
    href: "/app/templates",
    icon: LayoutTemplateIcon,
    group: "build",
    phase: null,
  },
  { key: "knowledge", href: "/app/knowledge", icon: BookOpenIcon, group: "build", phase: "P4" },
  { key: "runs", href: "/app/runs", icon: PlayCircleIcon, group: "operate", phase: null },
  {
    key: "approvals",
    href: "/app/approvals",
    icon: CheckCircle2Icon,
    group: "operate",
    phase: "P4",
  },
  { key: "integrations", href: "/app/integrations", icon: PlugIcon, group: "operate", phase: "P4" },
  { key: "analytics", href: "/app/analytics", icon: BarChart3Icon, group: "operate", phase: "P6" },
  { key: "billing", href: "/app/billing", icon: CreditCardIcon, group: "account", phase: "P5" },
  { key: "team", href: "/app/team", icon: UsersIcon, group: "account", phase: null },
  { key: "settings", href: "/app/settings", icon: SettingsIcon, group: "account", phase: null },
];

export function getNavItem(key: AppNavKey): AppNavItem {
  const item = APP_NAV.find((i) => i.key === key);
  if (!item) throw new Error(`Unknown nav key: ${key}`);
  return item;
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
