import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ConversationView } from "@/components/channels/conversation-view";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getConversation } from "@/modules/channels/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.channels.conversation };

export default async function ConversationPage(
  props: PageProps<"/app/integrations/conversations/[id]">,
) {
  const { id } = await props.params;
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated")
    redirect(`/sign-in?next=/app/integrations/conversations/${id}`);
  if (resolution.status === "no_organization") redirect("/onboarding");
  const { context } = resolution;

  const conversation = await getConversation(context.orgId, id);
  if (!conversation) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/app/integrations"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {t.channels.back}
      </Link>
      <PageHeader
        title={t.channels.conversation}
        subtitle={t.channels.statuses[conversation.status]}
      />
      <ConversationView
        t={t}
        orgId={context.orgId}
        conversation={conversation}
        canAct={can(context.role, "run.start")}
      />
    </div>
  );
}
