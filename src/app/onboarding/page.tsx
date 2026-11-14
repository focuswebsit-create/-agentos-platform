import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2Icon } from "lucide-react";
import { CreateOrgForm } from "@/components/onboarding/create-org-form";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { listMemberships } from "@/modules/tenancy/context";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: t.onboarding.title,
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
 * First-run: create an organisation.
 *
 * Deliberately outside /app, because the /app layout redirects here when the
 * user has no organisation — putting it inside would be a redirect loop.
 */
export default async function OnboardingPage() {
  const listed = await listMemberships();
  if (!listed) redirect("/sign-in?next=/onboarding");
  // Already has a workspace: nothing to onboard.
  if (listed.memberships.length > 0) redirect("/app");

  const steps = [t.onboarding.step1, t.onboarding.step2, t.onboarding.step3];

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
        className="relative z-10 mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-4xl items-center gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[1fr_380px]"
      >
        <section className="order-2 space-y-5 lg:order-1">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{t.onboarding.title}</h1>
            <p className="text-muted-foreground">{t.onboarding.subtitle}</p>
          </div>
          <div className="space-y-3 rounded-2xl border bg-card/60 p-5">
            <p className="text-sm font-medium">{t.onboarding.whatHappens}</p>
            <ul className="space-y-2.5">
              {steps.map((step) => (
                <li key={step} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {step}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="order-1 rounded-2xl border bg-card p-6 shadow-sm lg:order-2">
          <CreateOrgForm t={t} />
        </section>
      </main>
    </div>
  );
}
