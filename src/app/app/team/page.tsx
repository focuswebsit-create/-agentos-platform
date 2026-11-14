import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { TeamScreen } from "@/components/team/team-screen";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getSeatUsage, listPendingInvitations, listTeamMembers } from "@/modules/tenancy/team";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.team.title };

export default async function TeamPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/team");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const canInvite = can(context.role, "member.invite");

  // Invitations and seat usage are only fetched for roles allowed to see them.
  // RLS would return nothing anyway, but not asking is clearer than asking and
  // discarding, and it keeps an empty list from looking like a bug.
  const [members, invitations, seats] = await Promise.all([
    listTeamMembers(context.orgId),
    canInvite ? listPendingInvitations(context.orgId) : Promise.resolve([]),
    canInvite ? getSeatUsage(context.orgId) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title={t.team.title} subtitle={t.team.subtitle} />
      <TeamScreen
        t={t}
        orgId={context.orgId}
        viewerUserId={context.userId}
        viewerRole={context.role}
        members={members}
        invitations={invitations}
        canInvite={canInvite}
        seats={seats}
      />
    </>
  );
}
