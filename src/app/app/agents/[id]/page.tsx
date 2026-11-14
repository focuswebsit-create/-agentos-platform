import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { AgentEditor } from "@/components/agents/agent-editor";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getAgent } from "@/modules/agents/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.agents.editor.detailsHeading };

/**
 * An agent that belongs to another organisation is simply not found. RLS
 * already returns no row, and answering 404 rather than 403 keeps the URL from
 * confirming that a given agent id exists.
 */
export default async function AgentDetailPage(props: PageProps<"/app/agents/[id]">) {
  const { id } = await props.params;

  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect(`/sign-in?next=/app/agents/${id}`);
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const agent = await getAgent(context.orgId, id);
  if (!agent) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/app/agents"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {/* The arrow points start-ward, which in an RTL layout is to the right. */}
        <ArrowRightIcon className="size-4 rtl:rotate-0 ltr:rotate-180" aria-hidden />
        {t.agents.editor.backToList}
      </Link>

      <PageHeader title={agent.name} subtitle={agent.description ?? t.agents.subtitle} />

      <AgentEditor
        t={t}
        orgId={context.orgId}
        agent={agent}
        canEdit={can(context.role, "agent.update")}
        canPublish={can(context.role, "agent.publish")}
        canArchive={can(context.role, "agent.archive")}
      />
    </div>
  );
}
