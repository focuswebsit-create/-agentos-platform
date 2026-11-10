import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, Building2Icon } from "lucide-react";
import { AppMobileNav } from "@/components/app-shell/app-mobile-nav";
import { AppNavList, type AppSidebarLabels } from "@/components/app-shell/app-sidebar";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Logo } from "@/components/shared/logo";
import { Notice } from "@/components/shared/notice";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: { default: t.app.overview.title, template: `%s · ${t.common.brand}` },
  robots: { index: false, follow: false },
};

/**
 * Customer workspace shell. P0: no auth, no org, no data — every screen is a
 * truthful empty state. P1 adds session + org membership checks here.
 */
export default function AppLayout({ children }: LayoutProps<"/app">) {
  const labels: AppSidebarLabels = {
    nav: t.app.nav,
    groups: t.app.navGroups,
    ariaLabel: t.app.workspace,
  };

  return (
    <div className="flex min-h-dvh bg-muted/20">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Logo href="/app" label={t.common.brand} />
        </div>
        <div className="px-3 pt-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-card px-3 py-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Building2Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{t.app.workspace}</p>
              <DemoBadge label={t.common.demo} className="mt-0.5" />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <AppNavList labels={labels} />
        </div>
        <div className="border-t border-sidebar-border p-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <ArrowRightIcon aria-hidden className="size-4 ltr:rotate-180" />
            {t.common.backToSite}
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-2">
            <AppMobileNav
              labels={labels}
              brand={t.common.brand}
              openLabel={t.common.openMenu}
              closeLabel={t.common.closeMenu}
            />
            <Logo href="/app" label={t.common.brand} className="lg:hidden" />
            <span className="hidden text-sm text-muted-foreground lg:inline">
              {t.app.workspace}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <DemoBadge label={t.common.demo} />
            <ThemeToggle label={t.common.theme.toggle} />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:py-8"
        >
          <Notice variant="demo">{t.app.demoBanner}</Notice>
          {children}
        </main>
      </div>
    </div>
  );
}
