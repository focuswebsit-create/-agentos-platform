import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/auth/form-parts";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getUsageSummary } from "@/modules/runtime/data";
import { getEntitlements, listCatalog, type CatalogPlan } from "@/modules/billing/entitlements";
import { formatMoney } from "@/modules/billing/format";
import { getDictionary, interpolate } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.billing.title };

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function limit(value: number | null): string {
  return value === null ? t.billing.noFixedLimit : String(value);
}

/**
 * The billing screen shows what the SERVER enforces - every figure comes from
 * effective_entitlements(), the same function start_run consults - and says
 * plainly that nothing can be bought yet. A purchase button that looked live
 * would be a placeholder payment presented as real (CLAUDE.md rule 4).
 */
export default async function BillingPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/billing");
  if (resolution.status === "no_organization") redirect("/onboarding");
  const { context } = resolution;
  const seesUsage = can(context.role, "usage.read");

  const [entitlements, catalog, usage] = await Promise.all([
    getEntitlements(context.orgId),
    listCatalog(),
    seesUsage ? getUsageSummary(context.orgId) : Promise.resolve(null),
  ]);

  const ent = entitlements.ok ? entitlements.entitlements : null;
  const b = t.billing;

  return (
    <div className="space-y-6">
      <PageHeader title={b.title} subtitle={b.subtitle} />

      {!entitlements.ok ? (
        <FormAlert tone="info">
          {entitlements.reason === "not_provisioned" ? b.notProvisioned : b.loadError}
        </FormAlert>
      ) : null}

      {ent ? (
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
          data-testid="current-plan"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{b.currentHeading}</h2>
            <Badge variant={ent.source === "lapsed" ? "muted" : "secondary"}>
              {ent.planCode ? t.pricing.planNames[ent.planCode] : b.sources[ent.source]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {ent.source === "pilot"
              ? b.pilotBody
              : ent.source === "lapsed"
                ? b.lapsedBody
                : b.sources.subscription}
          </p>
          {ent.currentPeriodEnd ? (
            <p className="mt-2 text-sm">
              {interpolate(b.periodEnds, { date: ent.currentPeriodEnd.slice(0, 10) })}
              {ent.cancelAtPeriodEnd ? ` ${b.cancelsAtEnd}` : ""}
            </p>
          ) : null}

          <h3 className="mt-5 mb-2 text-sm font-semibold">{b.limitsHeading}</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{b.seats}</dt>
              <dd>{limit(ent.maxSeats)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{b.concurrency}</dt>
              <dd>{limit(ent.maxConcurrentRuns)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{b.knowledgeBases}</dt>
              <dd>{limit(ent.knowledgeBases)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{b.budget}</dt>
              <dd dir="ltr" className="font-mono">
                {usd(ent.monthlyModelBudgetUsdMicros)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-3 text-base font-semibold">{b.usageHeading}</h2>
        {usage ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3" data-testid="billing-usage">
            <div>
              <dt className="text-muted-foreground">{b.usageSpent}</dt>
              <dd dir="ltr" className="font-mono">
                {usd(usage.spentUsdMicros)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{b.usageReserved}</dt>
              <dd dir="ltr" className="font-mono">
                {usd(usage.reservedUsdMicros)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{b.usageRemaining}</dt>
              <dd dir="ltr" className="font-mono">
                {usd(
                  Math.max(
                    (ent?.monthlyModelBudgetUsdMicros ?? usage.capUsdMicros) -
                      usage.spentUsdMicros -
                      usage.reservedUsdMicros,
                    0,
                  ),
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{b.usageHidden}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{b.plansHeading}</h2>
        <FormAlert tone="info">{b.purchaseNote}</FormAlert>
        <div className="grid gap-4 md:grid-cols-3">
          {catalog.plans.map((plan: CatalogPlan) => (
            <article
              key={plan.code}
              className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm"
              data-testid={`plan-${plan.code}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{t.pricing.planNames[plan.code]}</h3>
                {ent?.planCode === plan.code ? (
                  <Badge variant="secondary">{b.currentBadge}</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{t.pricing.planTaglines[plan.code]}</p>
              <p className="mt-3 text-2xl font-bold">
                {formatMoney(
                  { amountMinor: plan.priceMinor, currency: plan.currency as "ILS" | "USD" },
                  "he",
                )}
                <span className="ms-1 text-sm font-normal text-muted-foreground">
                  {t.pricing.perMonth} · {t.pricing.vatNote}
                </span>
              </p>
              <ul className="mt-3 flex-1 space-y-1 text-sm">
                <li>{t.pricing.limits.agents}</li>
                <li>
                  {b.seats}: {limit(plan.maxSeats)}
                </li>
                <li>
                  {b.concurrency}: {limit(plan.maxConcurrentRuns)}
                </li>
                <li>
                  {b.knowledgeBases}: {limit(plan.knowledgeBases)}
                </li>
                <li>
                  {b.budget}: <span dir="ltr">{usd(plan.monthlyModelBudgetUsdMicros)}</span>
                </li>
              </ul>
              <Button className="mt-4" variant="outline" disabled>
                {b.purchaseUnavailable}
              </Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
