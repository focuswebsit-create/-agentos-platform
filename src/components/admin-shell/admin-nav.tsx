"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, type AdminNavKey } from "./admin-nav-config";

export function AdminNav({
  labels,
  ariaLabel,
  orientation = "vertical",
}: {
  labels: Record<AdminNavKey, string>;
  ariaLabel: string;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={ariaLabel}>
      <ul
        className={cn(
          orientation === "vertical"
            ? "space-y-0.5"
            : "flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]",
        )}
      >
        {ADMIN_NAV.map((item) => {
          const active =
            item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-admin/15 text-foreground ring-1 ring-admin/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-4", active && "text-admin")} />
                {labels[item.key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
