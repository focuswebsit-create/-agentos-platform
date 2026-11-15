import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PageHeader } from "@/components/shared/page-header";
import { FormAlert } from "@/components/auth/form-parts";
import { ChannelsManager } from "@/components/channels/channels-manager";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { listChannels } from "@/modules/channels/data";
import { listAgents } from "@/modules/agents/data";
import { getSiteUrl } from "@/config/env";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.channels.title };

export default async function IntegrationsPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/integrations");
  if (resolution.status === "no_organization") redirect("/onboarding");
  const { context } = resolution;

  const [channels, agents] = await Promise.all([
    listChannels(context.orgId),
    listAgents(context.orgId),
  ]);
  // The embed code needs an absolute URL. Prefer the configured site URL;
  // otherwise the host this page was served from (correct on every preview).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const siteUrl =
    getSiteUrl() ?? (host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : "");

  return (
    <div className="space-y-6">
      <PageHeader title={t.channels.title} subtitle={t.channels.subtitle} />
      {channels.ok ? (
        <ChannelsManager
          t={t}
          orgId={context.orgId}
          siteUrl={siteUrl}
          widgets={channels.widgets}
          conversations={channels.conversations}
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            published: a.activeVersionId !== null,
          }))}
          canManage={can(context.role, "org.update")}
        />
      ) : (
        <FormAlert tone="info">
          {channels.reason === "not_provisioned" ? t.channels.notProvisioned : t.channels.loadError}
        </FormAlert>
      )}
    </div>
  );
}
