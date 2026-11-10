import type { Metadata } from "next";
import Link from "next/link";
import { ShieldIcon } from "lucide-react";
import { AdminNav } from "@/components/admin-shell/admin-nav";
import { LogoMark } from "@/components/shared/logo";
import { Notice } from "@/components/shared/notice";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: { default: t.admin.title, template: `%s · ${t.admin.title}` },
  robots: { index: false, follow: false },
};

/**
 * Super Admin shell — a separate boundary from the customer `/app`.
 * Reachable only when ADMIN_SHELL_PREVIEW=true (see src/proxy.ts).
 * No data access, no mutations. Platform-admin auth + MFA arrives in P1/P6.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="h-1 bg-admin" aria-hidden />
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-latin text-lg font-bold">{t.admin.title}</span>
            <Badge variant="admin">
              <ShieldIcon aria-hidden />
              {t.admin.badge}
            </Badge>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {t.common.devEnvironment}
            </span>
            <ThemeToggle label={t.common.theme.toggle} />
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6 lg:hidden">
          <AdminNav labels={t.admin.nav} ariaLabel={t.admin.title} orientation="horizontal" />
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:py-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-24">
            <AdminNav labels={t.admin.nav} ariaLabel={t.admin.title} />
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 space-y-6">
          <Notice variant="locked">{t.admin.lockedBanner}</Notice>
          {children}
        </main>
      </div>
    </div>
  );
}
