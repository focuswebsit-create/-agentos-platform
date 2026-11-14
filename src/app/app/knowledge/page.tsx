import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { FormAlert } from "@/components/auth/form-parts";
import { KnowledgeManager } from "@/components/knowledge/knowledge-manager";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { listKnowledgeBases } from "@/modules/knowledge/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.knowledge.title };

export default async function KnowledgePage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/knowledge");
  if (resolution.status === "no_organization") redirect("/onboarding");
  const { context } = resolution;

  const list = await listKnowledgeBases(context.orgId);

  return (
    <div className="space-y-6">
      <PageHeader title={t.knowledge.title} subtitle={t.knowledge.subtitle} />
      <FormAlert tone="info">{t.knowledge.howItWorks}</FormAlert>
      {list.ok ? (
        <KnowledgeManager
          t={t}
          orgId={context.orgId}
          bases={list.bases}
          canWrite={can(context.role, "knowledge.write")}
          canDelete={can(context.role, "knowledge.delete")}
        />
      ) : (
        <FormAlert tone="info">
          {list.reason === "not_provisioned" ? t.knowledge.notProvisioned : t.knowledge.loadError}
        </FormAlert>
      )}
    </div>
  );
}
