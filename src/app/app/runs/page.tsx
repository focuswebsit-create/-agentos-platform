import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { listRuns, getUsageSummary, type RunStatus } from "@/modules/runtime/data";
import { hasAnyConfiguredProvider } from "@/modules/agent-engine/registry";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.runs.title };

const STATUS_VARIANT: Record<RunStatus, "default" | "secondary" | "outline" | "muted" | "demo"> = {
  queued: "outline",
  running: "default",
  awaiting_approval: "demo",
  succeeded: "secondary",
  failed: "muted",
  cancelled: "muted",
};

/** Micros to a dollar string. Integer arithmetic; the division is for display only. */
function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

export default async function RunsPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/runs");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const [runs, usage] = await Promise.all([
    listRuns(context.orgId),
    can(context.role, "usage.read") ? getUsageSummary(context.orgId) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t.runs.title} subtitle={t.runs.subtitle} />

      {/* Stated wherever a result can be seen, not only where it is produced. */}
      {hasAnyConfiguredProvider() && runs.length > 0 ? (
        <p className="rounded-lg border border-border bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground">
          {t.runs.simulatedNotice}
        </p>
      ) : null}

      {usage ? (
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold">{t.runs.usageHeading}</h2>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            {[
              [t.runs.usageSpent, usage.spentUsdMicros],
              [t.runs.usageReserved, usage.reservedUsdMicros],
              [t.runs.usageCap, usage.capUsdMicros],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd dir="ltr" className="font-mono text-base">
                  {usd(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card shadow-sm">
        {runs.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">{t.runs.empty}</p>
        ) : (
          <ul className="divide-y">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/app/runs/${run.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{run.agentName}</span>
                    <time
                      dateTime={run.createdAt}
                      dir="ltr"
                      className="text-xs text-muted-foreground"
                    >
                      {run.createdAt.slice(0, 16).replace("T", " ")}
                    </time>
                  </span>
                  <Badge variant={STATUS_VARIANT[run.status]}>{t.runs.statuses[run.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
