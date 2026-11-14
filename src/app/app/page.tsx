import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDollarSignIcon,
  MailIcon,
  PlayCircleIcon,
  UsersIcon,
  WandSparklesIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getSeatUsage, listPendingInvitations, listTeamMembers } from "@/modules/tenancy/team";
import { listAgents } from "@/modules/agents/data";
import { listRuns, getUsageSummary } from "@/modules/runtime/data";
import { getDictionary, interpolate } from "@/i18n";

const t = getDictionary();

/**
 * Workspace overview.
 *
 * Shows real numbers for what exists (people, seats, invitations) and says
 * plainly which phase the rest arrives in. The P0 version displayed "no data —
 * no organization connected" on every card; an organisation is connected now,
 * so leaving that in place would have been a false statement on the first
 * screen a customer sees (CLAUDE.md rule 4).
 */
export default async function DashboardPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const o = t.app.overview;
  const isAdmin = can(context.role, "member.invite");

  const [members, invitations, seats, agents, runs, usage] = await Promise.all([
    listTeamMembers(context.orgId),
    isAdmin ? listPendingInvitations(context.orgId) : Promise.resolve([]),
    isAdmin ? getSeatUsage(context.orgId) : Promise.resolve(null),
    listAgents(context.orgId),
    listRuns(context.orgId),
    can(context.role, "usage.read") ? getUsageSummary(context.orgId) : Promise.resolve(null),
  ]);

  // Real, measured values. Nothing here is a placeholder.
  const live = [
    {
      key: "members",
      icon: UsersIcon,
      label: o.members,
      value: String(members.length),
      note: null,
    },
    ...(seats
      ? [
          {
            key: "seats",
            icon: CheckCircle2Icon,
            label: o.seats,
            value: `${seats.seatsTaken}/${seats.seatLimit}`,
            note: null,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            key: "invites",
            icon: MailIcon,
            label: o.pendingInvites,
            value: String(invitations.length),
            note: null,
          },
        ]
      : []),
    {
      key: "agents",
      icon: BotIcon,
      label: o.cards.agents,
      value: String(agents.length),
      note: null,
    },
    {
      key: "runs",
      icon: PlayCircleIcon,
      label: o.cards.runs,
      value: String(runs.length),
      note: null,
    },
    // Spend is a measurement for those who may see it and absent for everyone
    // else, rather than shown as zero. 0014 withholds the figure from members
    // and viewers, so a zero here would be a wrong number, not a private one.
    ...(usage
      ? [
          {
            key: "spend",
            icon: CircleDollarSignIcon,
            label: o.cards.spend,
            value: `$${(usage.spentUsdMicros / 1_000_000).toFixed(2)}`,
            note: null,
          },
        ]
      : []),
  ];

  // Every card above is now measured. This stays, empty, so the next unbuilt
  // metric has somewhere honest to go instead of appearing as a zero.
  const planned: Array<{ key: string; icon: typeof BotIcon; label: string; phase: string }> = [];

  const steps = [
    { label: o.quickStart.orgCreated, done: true },
    {
      label: members.length > 1 ? o.quickStart.inviteTeamDone : o.quickStart.inviteTeam,
      done: members.length > 1,
    },
    {
      label: agents.length > 0 ? o.quickStart.buildAgentDone : o.quickStart.buildAgent,
      done: agents.length > 0,
    },
    {
      label: runs.length > 0 ? o.quickStart.runAgentDone : o.quickStart.runAgent,
      done: runs.length > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={o.title} subtitle={context.orgName} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {live.map((c) => (
          <StatCard key={c.key} icon={c.icon} label={c.label} value={c.value} />
        ))}
        {planned.map((c) => (
          <StatCard
            key={c.key}
            icon={c.icon}
            label={c.label}
            value={t.common.emptyValue}
            note={interpolate(o.cardsNotPlanned, { phase: c.phase })}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{o.quickStart.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {steps.map((step) => (
                <li key={step.label} className="flex items-start gap-3 text-sm">
                  {step.done ? (
                    <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <CircleDashedIcon
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className={step.done ? "text-muted-foreground line-through" : undefined}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
            {isAdmin ? (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/app/team">{t.team.inviteHeading}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -top-16 -end-16 size-48 rounded-full bg-linear-to-br from-brand-blue/20 to-brand-violet/20 blur-2xl"
          />
          <CardHeader className="relative">
            <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-brand-blue via-brand-indigo to-brand-violet text-white">
              <WandSparklesIcon aria-hidden className="size-5" />
            </span>
            <CardTitle className="font-latin">{o.studioCard.title}</CardTitle>
            <CardDescription>{o.studioCard.body}</CardDescription>
          </CardHeader>
          <CardContent className="relative">
            <Button asChild variant="brand">
              <Link href="/app/agents">{o.studioCard.button}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
