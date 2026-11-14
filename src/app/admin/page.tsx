import {
  AlertTriangleIcon,
  BotIcon,
  Building2Icon,
  CircleDollarSignIcon,
  CpuIcon,
  PlayCircleIcon,
  UsersIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { requireAdminOrNotFound } from "@/modules/platform-admin/guard";
import { adminOverview } from "@/modules/platform-admin/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();

/**
 * Platform overview.
 *
 * Measured: organisations, members, agents, runs, failures, and model spend
 * for the current period. Every one of those comes from a row somebody
 * created.
 *
 * NOT measured, and therefore absent rather than zero: MRR, paid
 * organisations, trial-to-paid conversion, overdue payments. `SUPER_ADMIN.md`
 * defines MRR as "recognized contracted recurring prices on active paid subs",
 * and there are no subscriptions until P5. A zero in those cards would be a
 * financial statement, and a false one — the correct reading is "we do not
 * know yet", which is what the placeholder says.
 *
 * `SUPER_ADMIN.md`: "Empty states must state 'No data' not invented sample
 * production numbers."
 */
export default async function AdminOverviewPage() {
  const admin = await requireAdminOrNotFound();
  const o = t.admin.overview;
  const stats = await adminOverview(admin);

  const measured = [
    {
      key: "orgs",
      icon: Building2Icon,
      label: o.cards.organizations,
      value: String(stats.organizations),
    },
    { key: "members", icon: UsersIcon, label: o.cards.members, value: String(stats.members) },
    { key: "agents", icon: BotIcon, label: o.cards.agents, value: String(stats.agents) },
    { key: "runs", icon: PlayCircleIcon, label: o.cards.runs, value: String(stats.runs) },
    {
      key: "failed",
      icon: AlertTriangleIcon,
      label: o.cards.failedRuns,
      value: String(stats.failedRuns),
    },
    {
      key: "spend",
      icon: CpuIcon,
      label: o.cards.apiCost,
      // The money is held as integer micros; this division is for display and
      // nothing reads it back.
      value: `$${(stats.spentThisPeriodUsdMicros / 1_000_000).toFixed(2)}`,
    },
  ];

  const pending = [
    { key: "mrr", icon: CircleDollarSignIcon, label: o.cards.mrr },
    { key: "paidOrgs", icon: Building2Icon, label: o.cards.paidOrgs },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={o.title} subtitle={o.subtitle} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {measured.map((c) => (
          <StatCard key={c.key} icon={c.icon} label={c.label} value={c.value} />
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">{o.pendingHeading}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pending.map((c) => (
            <StatCard
              key={c.key}
              icon={c.icon}
              label={c.label}
              value={t.common.emptyValue}
              note={o.pendingNote}
            />
          ))}
        </div>
      </div>

      {stats.suspendedOrganizations > 0 ? (
        <p className="rounded-lg border border-border bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground">
          {o.suspendedNote.replace("{n}", String(stats.suspendedOrganizations))}
        </p>
      ) : null}
    </div>
  );
}
