import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateCatalog } from "@/components/agents/template-catalog";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { listTemplates } from "@/modules/templates/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.templates.title };

export default async function TemplatesPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/templates");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const templates = await listTemplates();

  return (
    <div className="space-y-6">
      <PageHeader title={t.templates.title} subtitle={t.templates.subtitle} />
      {templates.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground shadow-sm">
          {t.templates.empty}
        </p>
      ) : (
        <TemplateCatalog
          t={t}
          orgId={context.orgId}
          templates={templates}
          canInstall={can(context.role, "agent.create")}
        />
      )}
    </div>
  );
}
