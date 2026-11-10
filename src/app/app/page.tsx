import Link from "next/link";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDollarSignIcon,
  PlayCircleIcon,
  WandSparklesIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary } from "@/i18n";

export default function DashboardPage() {
  const t = getDictionary();
  const o = t.app.overview;
  const empty = t.common.emptyValue;

  const cards = [
    { key: "agents", icon: BotIcon, label: o.cards.agents },
    { key: "runs", icon: PlayCircleIcon, label: o.cards.runs },
    { key: "spend", icon: CircleDollarSignIcon, label: o.cards.spend },
    { key: "approvals", icon: CheckCircle2Icon, label: o.cards.approvals },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader title={o.title} subtitle={o.subtitle} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.key} icon={c.icon} label={c.label} value={empty} note={o.cardsNote} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{o.quickStart.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {o.quickStart.items.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <CircleDashedIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ol>
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
              <Link href="/app/agents/studio">{o.studioCard.button}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
