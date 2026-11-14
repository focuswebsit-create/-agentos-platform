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

const LIVE: readonly RunStatus[] = ["queued", "running", "awaiting_approval"];

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
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
            <Badge variant={STATUS_VARIANT[run.status]}>{t.runs.statuses[run.status]}</Badge>
            {live && can(context.role, "run.cancel") ? (
              <CancelRunButton t={t} orgId={context.orgId} runId={run.id} />
            ) : null}
          </span>
        }
      />

      {hasAnyConfiguredProvider() ? (
        <p className="rounded-lg border border-border bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground">
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
        {run.errorCode ? (
          <p dir="ltr" className="mt-3 font-mono text-xs text-muted-foreground">
            {run.errorCode}
          </p>
        ) : null}
      </section>

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
