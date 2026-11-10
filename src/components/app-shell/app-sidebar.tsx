"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAV, isActivePath, type AppNavKey, type NavGroup } from "./nav-config";

export interface AppSidebarLabels {
  nav: Record<AppNavKey, string>;
  groups: Record<NavGroup, string>;
  ariaLabel: string;
}

export function AppNavList({
  labels,
  onNavigate,
}: {
  labels: AppSidebarLabels;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const ungrouped = APP_NAV.filter((i) => i.group === null);
  const groups: NavGroup[] = ["build", "operate", "account"];

  const renderItem = (item: (typeof APP_NAV)[number]) => {
    const active = isActivePath(pathname, item.href);
    const Icon = item.icon;
    return (
      <li key={item.key}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-colors",
              active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
            )}
          />
          {labels.nav[item.key]}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label={labels.ariaLabel} className="flex flex-col gap-5">
      <ul className="space-y-0.5">{ungrouped.map(renderItem)}</ul>
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
            {labels.groups[g]}
          </p>
          <ul className="space-y-0.5">{APP_NAV.filter((i) => i.group === g).map(renderItem)}</ul>
        </div>
      ))}
    </nav>
  );
}
