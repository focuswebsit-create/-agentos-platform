import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { AppMobileNav } from "@/components/app-shell/app-mobile-nav";
import { AppNavList, type AppSidebarLabels } from "@/components/app-shell/app-sidebar";
import { WorkspaceMenu, type WorkspaceOption } from "@/components/app-shell/workspace-menu";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: { default: t.app.overview.title, template: `%s · ${t.common.brand}` },
  robots: { index: false, follow: false },
};

/**
 * Never prerendered, never cached.
 *
 * Every screen under here is resolved against the signed-in user and their
 * active organisation, so a shared prerendered copy would be one tenant's data
 * served to another. `cacheComponents` is on for the marketing site, which
 * benefits from it; authenticated routes opt out explicitly.
 */
export const instant = false;

/**
 * Customer workspace shell.
 *
 * The proxy has already turned away requests with no session, but this is a
 * second, independent check: a layout that trusted the proxy alone would
 * render tenant data if the matcher were ever mis-edited.
 *
 * The demo banner and DEMO badges are gone from here. Everything inside this
 * shell is now bound to a real organisation, and labelling real data as a
 * demo would be as misleading as the reverse.
 */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const resolution = await resolveOrgContext();

  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;

  const labels: AppSidebarLabels = {
    nav: t.app.nav,
    groups: t.app.navGroups,
    ariaLabel: t.app.workspace,
  };

  const options: WorkspaceOption[] = context.memberships.map((m) => ({
    orgId: m.orgId,
    orgName: m.orgName,
    role: m.role,
  }));

  const current: WorkspaceOption = {
    orgId: context.orgId,
    orgName: context.orgName,
    role: context.role,
  };

  return (
    <div className="flex min-h-dvh bg-muted/20">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Logo href="/app" label={t.common.brand} />
        </div>
        <div className="px-3 pt-4">
          <WorkspaceMenu
            current={current}
            options={options}
            roleLabels={t.team.roles}
            signOutLabel={t.auth.signOut}
          />
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
          <div className="flex min-w-0 items-center gap-2">
            <AppMobileNav
              labels={labels}
              brand={t.common.brand}
              openLabel={t.common.openMenu}
              closeLabel={t.common.closeMenu}
            />
            <Logo href="/app" label={t.common.brand} className="lg:hidden" />
            <span className="hidden truncate text-sm text-muted-foreground lg:inline">
              {context.orgName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle label={t.common.theme.toggle} />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:py-8"
        >
          {/* SUPER_ADMIN.md requires a warning alongside a suspension. Shown on
              every page rather than one, because a customer whose runs stop
              working needs to know why wherever they happen to be, and the
              reason is operator-written text about the account, not customer
              content. */}
          {context.orgStatus === "suspended" ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-medium">{t.app.suspended.title}</p>
              <p className="mt-1 leading-relaxed">{t.app.suspended.body}</p>
              {context.orgSuspensionReason ? (
                <p className="mt-2">
                  <span className="font-medium">{t.app.suspended.reasonLabel}:</span>{" "}
                  {context.orgSuspensionReason}
                </p>
              ) : null}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
