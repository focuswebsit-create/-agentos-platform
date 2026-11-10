import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { marketingNav } from "@/config/site";
import type { Dictionary } from "@/i18n";
import { MobileNav } from "./mobile-nav";

export function SiteHeader({ t }: { t: Dictionary }) {
  const links = marketingNav.map((item) => ({ href: item.href, label: t.marketingNav[item.key] }));
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo label={t.common.brand} />
          <nav aria-label={t.marketingNav.product} className="hidden md:block">
            <ul className="flex items-center gap-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle label={t.common.theme.toggle} />
          <Button asChild variant="brand" size="sm" className="hidden sm:inline-flex">
            <Link href="/app">{t.marketingNav.getStarted}</Link>
          </Button>
          <MobileNav
            links={links}
            brand={t.common.brand}
            openLabel={t.common.openMenu}
            closeLabel={t.common.closeMenu}
            ctaLabel={t.marketingNav.getStarted}
            ctaNote={t.signupClosed}
          />
        </div>
      </div>
    </header>
  );
}
