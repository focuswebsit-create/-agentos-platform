import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { CreateAgentForm } from "@/components/agents/create-agent-form";
import { Badge } from "@/components/ui/badge";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { listAgents } from "@/modules/agents/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.agents.title };

const STATUS_VARIANT = {
  draft: "outline",
  published: "secondary",
  archived: "muted",
} as const;

export default async function AgentsPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/agents");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const canCreate = can(context.role, "agent.create");
  const agents = await listAgents(context.orgId);

  return (
    <div className="space-y-6">
      <PageHeader title={t.agents.title} subtitle={t.agents.subtitle} />

      <section className="rounded-2xl border bg-card shadow-sm">
        {agents.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">{t.agents.empty}</p>
        ) : (
          <ul className="divide-y">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link
                  href={`/app/agents/${agent.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{agent.name}</span>
                    {agent.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {agent.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {agent.publishedVersion === null
                        ? t.agents.neverPublished
                        : t.agents.publishedVersion.replace("{n}", String(agent.publishedVersion))}
                    </span>
                    <Badge variant={STATUS_VARIANT[agent.status]}>
                      {t.agents.statuses[agent.status]}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canCreate ? (
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold">{t.agents.createHeading}</h2>
          <CreateAgentForm t={t} orgId={context.orgId} />
        </section>
      ) : null}
    </div>
  );
}
