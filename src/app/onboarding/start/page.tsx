import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/auth/form-parts";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { CreateAgentForm } from "@/components/agents/create-agent-form";
import { TemplateCatalog } from "@/components/agents/template-catalog";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { listAgents } from "@/modules/agents/data";
import { listTemplates } from "@/modules/templates/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: t.onboardingStart.title,
  robots: { index: false, follow: false },
};

export const instant = false;

/**
 * First run, second step: "create from template or blank" (PRD.md section 4).
 *
 * Shown only while the organisation has no agents. Once it has one there is
 * nothing to onboard, and leaving the screen reachable would make it a second,
 * worse copy of /app/templates.
 *
 * ROADMAP.md P2 also lists "onboarding wizard with synthetic sample". There is
 * deliberately no sample output here. No provider is connected, so any output
 * would be text written by hand and shown where a run result goes — a
 * production dummy result, which CLAUDE.md rule 4 forbids. The screen says so
 * instead. A real sample becomes possible in P3, when a run can produce one.
 */
export default async function OnboardingStartPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/onboarding/start");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const [agents, templates] = await Promise.all([listAgents(context.orgId), listTemplates()]);
  if (agents.length > 0) redirect("/app");

  const canCreate = can(context.role, "agent.create");

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.4]" aria-hidden />

      <header className="relative z-10 mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo label={t.common.brand} />
        <ThemeToggle label={t.common.theme.toggle} />
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto w-full max-w-4xl space-y-8 px-4 pb-16 sm:px-6"
      >
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t.onboardingStart.title}</h1>
          <p className="text-muted-foreground">{t.onboardingStart.subtitle}</p>
        </div>

        <FormAlert tone="info">{t.onboardingStart.noRunNotice}</FormAlert>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t.onboardingStart.templatesHeading}</h2>
          {templates.length === 0 ? (
            <p className="rounded-2xl border bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm">
              {t.onboardingStart.noTemplates}
            </p>
          ) : (
            <TemplateCatalog
              t={t}
              orgId={context.orgId}
              templates={templates}
              canInstall={canCreate}
            />
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t.onboardingStart.blankHeading}</h2>
          <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <p className="mb-4 text-sm text-muted-foreground">{t.onboardingStart.blankBody}</p>
            {canCreate ? (
              <CreateAgentForm t={t} orgId={context.orgId} />
            ) : (
              <p className="text-sm text-muted-foreground">{t.agents.noCreatePermission}</p>
            )}
          </div>
        </section>

        <Button asChild variant="ghost">
          <Link href="/app">{t.onboardingStart.skip}</Link>
        </Button>
      </main>
    </div>
  );
}
