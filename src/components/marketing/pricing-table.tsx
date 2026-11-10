import { CheckIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { interpolate, type Dictionary } from "@/i18n";
import { formatMoney, formatUsdCents, HIGHLIGHTED_PLAN, PLANNED_PLANS } from "@/modules/billing";
import type { Locale, PlanVersion } from "@/modules/contracts";
import { cn } from "@/lib/utils";

function countLabel(n: number | null, plural: string, single: string, unlimited?: string) {
  if (n === null) return unlimited ?? plural;
  return n === 1 ? single : interpolate(plural, { n });
}

export function planFeatureList(plan: PlanVersion, t: Dictionary, locale: Locale): string[] {
  const l = t.pricing.limits;
  const lim = plan.limits;
  return [
    l.agents,
    countLabel(lim.maxSeats, l.seats, l.singleSeat),
    countLabel(lim.maxActiveTeams, l.teams, l.singleTeam, l.unlimitedTeams),
    countLabel(lim.maxConcurrentRuns, l.concurrency, l.singleConcurrency),
    interpolate(l.budget, { amount: formatUsdCents(lim.monthlyModelBudgetUsdCents, locale) }),
    countLabel(lim.knowledgeBases, l.knowledgeBases, l.singleKnowledgeBase),
  ];
}

export function PricingTable({ t, locale }: { t: Dictionary; locale: Locale }) {
  const p = t.pricing;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PLANNED_PLANS.map((plan) => {
        const highlighted = plan.code === HIGHLIGHTED_PLAN;
        return (
          <Card
            key={plan.code}
            data-testid={`plan-${plan.code}`}
            data-availability={plan.availability}
            className={cn(
              "relative transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg",
              highlighted &&
                "border-primary/40 shadow-lg shadow-brand-indigo/10 ring-1 ring-primary/20 lg:-my-2 lg:py-8",
            )}
          >
            {highlighted ? (
              <Badge className="absolute -top-3 start-6 bg-linear-to-l from-brand-violet to-brand-blue">
                <SparklesIcon aria-hidden />
                {p.highlighted}
              </Badge>
            ) : null}
            <CardHeader>
              <CardTitle className="font-latin text-xl">{p.planNames[plan.code]}</CardTitle>
              <p className="text-sm text-muted-foreground">{p.planTaglines[plan.code]}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight tabular-nums">
                    {formatMoney(plan.price, locale)}
                  </span>
                  <span className="text-sm text-muted-foreground">{p.perMonth}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{p.vatNote}</p>
              </div>
              <ul className="space-y-2.5 text-sm">
                {planFeatureList(plan, t, locale).map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto">
              {/* No checkout exists in P0. The button is disabled and says so. */}
              <Button
                className="w-full"
                variant={highlighted ? "brand" : "outline"}
                disabled
                aria-disabled
              >
                {p.cta}
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
