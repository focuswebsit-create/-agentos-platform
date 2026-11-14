import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { CancelRunButton } from "@/components/runs/cancel-run-button";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getRun, type RunStatus } from "@/modules/runtime/data";
import { RunLiveWatcher } from "@/components/runs/run-live-watcher";
import { getRuntimeHealth, type RuntimeHealth } from "@/modules/runtime/readiness";
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

const LIVE: readonly RunStatus[] = ["queued", "running", "awaiting_approval"];

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

/** Codes whose cause is the deployment, not the run: show the health check. */
const ENVIRONMENT_CODES = new Set([
  "PROVIDER_NOT_CONFIGURED",
  "RUNTIME_NOT_CONFIGURED",
  "RUNTIME_DB_UNAVAILABLE",
  "RUN_NOT_STARTED",
  "RUN_ABANDONED",
  "PROVIDER_AUTH",
]);

function explain(code: string): string | null {
  const map = t.runs.errors as Record<string, string>;
  return map[code] ?? null;
}

/** Request-time age. A server component renders once per request, so this is stable. */
function msSince(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default async function RunDetailPage(props: PageProps<"/app/runs/[id]">) {
  const { id } = await props.params;

  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect(`/sign-in?next=/app/runs/${id}`);
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const run = await getRun(context.orgId, id);
  if (!run) notFound();

  const live = LIVE.includes(run.status);
  const seesCost = can(context.role, "usage.read");
  const simulated =
    run.versionProvider === "mock" || run.steps.some((step) => step.provider === "mock");

  const tokensIn = run.steps.reduce((sum, step) => sum + num(step.summary.inputTokens), 0);
  const tokensOut = run.steps.reduce((sum, step) => sum + num(step.summary.outputTokens), 0);
  const totalCost = run.steps.reduce((sum, step) => sum + (step.usageUsdMicros ?? 0), 0);
  const hasUsage = run.steps.some((step) => step.summary.inputTokens !== undefined);

  // Owners and admins see why a run could not execute, as booleans, without
  // reading server logs. Only fetched when it is relevant: it makes a probe.
  const queuedFor = msSince(run.createdAt);
  const showHealth =
    seesCost &&
    ((run.status === "queued" && queuedFor > 30_000) ||
      (run.errorCode !== null && ENVIRONMENT_CODES.has(run.errorCode)));
  const health: RuntimeHealth | null = showHealth ? await getRuntimeHealth(context.orgId) : null;

  return (
    <div className="space-y-6">
      <Link
        href="/app/runs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRightIcon className="size-4 ltr:rotate-180" aria-hidden />
        {t.runs.backToList}
      </Link>

      <PageHeader
        title={run.agentName}
        subtitle={run.createdAt.slice(0, 16).replace("T", " ")}
        actions={
          <span className="flex items-center gap-2">
            {run.isTest ? <Badge variant="demo">{t.runs.testBadge}</Badge> : null}
            <Badge variant={STATUS_VARIANT[run.status]}>{t.runs.statuses[run.status]}</Badge>
            {live && can(context.role, "run.cancel") ? (
              <CancelRunButton t={t} orgId={context.orgId} runId={run.id} />
            ) : null}
          </span>
        }
      />

      {live ? (
        <RunLiveWatcher
          t={t}
          orgId={context.orgId}
          runId={run.id}
          status={run.status as "queued" | "running" | "awaiting_approval"}
          createdAt={run.createdAt}
          canKick={can(context.role, "run.start")}
        />
      ) : null}

      {/* Decided by what THIS run executed - its pinned version's provider and
          its trace - never by which providers the deployment has enabled. */}
      {simulated ? (
        <p
          data-testid="run-simulation-notice"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm font-medium"
        >
          {t.runs.simulatedNotice}
        </p>
      ) : null}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-3 text-base font-semibold">{t.runs.outputHeading}</h2>
        {run.output ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{run.output}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {live ? t.runs.outputPending : t.runs.outputNone}
          </p>
        )}
        {run.truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">{t.runs.usage.truncated}</p>
        ) : null}
        {run.errorCode ? (
          <div className="mt-3 space-y-1" data-testid="run-error">
            {explain(run.errorCode) ? <p className="text-sm">{explain(run.errorCode)}</p> : null}
            <p dir="ltr" className="font-mono text-xs text-muted-foreground">
              {run.errorCode}
            </p>
          </div>
        ) : null}
      </section>

      {hasUsage ? (
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
          data-testid="run-usage"
        >
          <h2 className="mb-3 text-base font-semibold">{t.runs.usage.heading}</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t.runs.usage.tokensIn}</dt>
              <dd dir="ltr" className="font-mono">
                {tokensIn.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.runs.usage.tokensOut}</dt>
              <dd dir="ltr" className="font-mono">
                {tokensOut.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.runs.usage.cost}</dt>
              <dd dir="ltr" className="font-mono">
                {seesCost ? usd(totalCost) : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t.runs.usage.estimateNote}</p>
        </section>
      ) : null}

      {health ? (
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
          data-testid="runtime-health"
        >
          <h2 className="mb-1 text-base font-semibold">{t.runs.health.heading}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t.runs.health.intro}</p>
          <ul className="space-y-1.5 text-sm">
            {(Object.keys(health) as Array<keyof RuntimeHealth>).map((key) => (
              <li key={key} className="flex items-center justify-between gap-3">
                <span>{t.runs.health[key]}</span>
                <span
                  className={
                    health[key] ? "font-medium text-emerald-600" : "font-medium text-destructive"
                  }
                >
                  {health[key] ? t.runs.health.yes : t.runs.health.no}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card shadow-sm">
        <h2 className="border-b px-5 py-4 text-base font-semibold">{t.runs.traceHeading}</h2>
        {run.steps.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t.runs.traceEmpty}</p>
        ) : (
          <ul className="divide-y">
            {run.steps.map((step) => (
              <li
                key={step.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-4"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {step.stepIndex + 1}. {step.kind}
                  </span>
                  <span dir="ltr" className="block truncate text-xs text-muted-foreground">
                    {[step.provider, step.model].filter(Boolean).join(" · ") || "—"}
                    {step.errorCode ? ` · ${step.errorCode}` : ""}
                  </span>
                </span>
                <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                  {/* 0014 withholds usage from members and viewers, so the value
                      arrives null for them. Saying why beats an empty cell. */}
                  {seesCost && step.usageUsdMicros !== null ? usd(step.usageUsdMicros) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!seesCost ? (
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t.runs.costHidden}</p>
        ) : null}
      </section>
    </div>
  );
}
