import type { Metadata } from "next";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { isSupabaseConfigured } from "@/config/env";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: { default: t.auth.signIn.title, template: `%s · ${t.common.brand}` },
  robots: { index: false, follow: false },
};

/**
 * Shell for the authentication screens.
 *
 * Shares P0's design language — the brand gradient, the grid backdrop, the
 * same card radius and spacing — so signing in does not feel like a different
 * product from the marketing site it was reached from.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.4]" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 end-[-10rem] size-[32rem] rounded-full bg-linear-to-br from-brand-violet/20 via-brand-indigo/10 to-transparent blur-3xl"
        aria-hidden
      />

      <header className="relative z-10 mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo label={t.common.brand} />
        <ThemeToggle label={t.common.theme.toggle} />
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center px-4 pb-16 sm:px-6"
      >
        {/* A sign-in form that cannot reach the identity service is worse than
            no form: it accepts a password and fails silently. Say so instead. */}
        {isSupabaseConfigured() ? (
          children
        ) : (
          <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
            <h1 className="text-lg font-semibold">{t.auth.unavailable.title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t.auth.unavailable.body}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
