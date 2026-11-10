import Link from "next/link";
import {
  ArrowLeftIcon,
  CodeXmlIcon,
  GaugeIcon,
  LayoutTemplateIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  RocketIcon,
  type LucideIcon,
} from "lucide-react";
import { AgentTeamDiagram } from "@/components/marketing/agent-team-diagram";
import { TemplateCards } from "@/components/marketing/template-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDictionary } from "@/i18n";

const PILLAR_ICONS: readonly LucideIcon[] = [CodeXmlIcon, ShieldCheckIcon, GaugeIcon];
const STEP_ICONS: readonly LucideIcon[] = [
  LayoutTemplateIcon,
  SlidersHorizontalIcon,
  PlayCircleIcon,
  RocketIcon,
];

function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <h2 id={id} className="text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {subtitle ? <p className="mt-3 text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

export default function HomePage() {
  const t = getDictionary();
  const h = t.home;

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="bg-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]"
        />
        <div
          aria-hidden
          className="absolute -top-40 start-1/2 -z-10 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-linear-to-r from-brand-blue/20 via-brand-indigo/20 to-brand-violet/20 blur-3xl rtl:translate-x-1/2"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-28">
          <div className="animate-fade-up space-y-7 text-center lg:text-start">
            <Badge variant="outline" className="bg-card/70 px-3 py-1 backdrop-blur">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-brand-violet" />
              {h.hero.eyebrow}
            </Badge>
            <h1 className="text-4xl leading-[1.15] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              <span className="text-gradient-brand">{h.hero.title}</span>
            </h1>
            <p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty lg:mx-0">
              {h.hero.subtitle}
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Button asChild variant="brand" size="lg" className="w-full sm:w-auto">
                <Link href="/app">
                  {h.hero.primaryCta}
                  <ArrowLeftIcon aria-hidden className="ltr:rotate-180" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                <Link href="#demo">
                  <PlayCircleIcon aria-hidden />
                  {h.hero.secondaryCta}
                </Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{h.hero.microcopy}</p>
          </div>
          <div id="demo" className="scroll-mt-24 animate-fade-up [animation-delay:120ms]">
            <AgentTeamDiagram t={t} />
          </div>
        </div>
      </section>

      {/* Value pillars */}
      <section id="product" aria-labelledby="pillars-title" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading id="pillars-title" title={h.pillars.title} />
          <div className="grid gap-5 md:grid-cols-3">
            {h.pillars.items.map((p, i) => {
              const Icon = PILLAR_ICONS[i] ?? ShieldCheckIcon;
              return (
                <Card key={p.title} className="transition-shadow hover:shadow-md">
                  <CardContent className="space-y-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-linear-to-br from-brand-blue/15 via-brand-indigo/15 to-brand-violet/15 text-primary">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <h3 className="text-lg font-semibold">{p.title}</h3>
                    <p className="leading-relaxed text-muted-foreground">{p.body}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-title" className="border-y bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading id="how-title" title={h.how.title} />
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {h.how.steps.map((s, i) => {
              const Icon = STEP_ICONS[i] ?? RocketIcon;
              return (
                <li key={s.title} className="relative rounded-2xl border bg-card p-5">
                  <span className="font-latin absolute top-4 end-4 text-sm font-bold text-muted-foreground/50">
                    0{i + 1}
                  </span>
                  <Icon aria-hidden className="mb-3 size-6 text-primary" />
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Templates */}
      <section id="templates" aria-labelledby="templates-title" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            id="templates-title"
            title={h.templates.title}
            subtitle={h.templates.subtitle}
          />
          <TemplateCards t={t} />
        </div>
      </section>

      {/* Truthful trust section — no invented social proof */}
      <section aria-labelledby="trust-title" className="pb-8">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 id="trust-title" className="text-xl font-semibold">
            {h.trust.title}
          </h2>
          <p className="mt-2 text-muted-foreground">{h.trust.body}</p>
        </div>
      </section>

      {/* CTA */}
      <section aria-labelledby="cta-title" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-linear-to-br from-brand-blue via-brand-indigo to-brand-violet px-6 py-14 text-center text-white shadow-2xl shadow-brand-indigo/20 sm:px-12">
            <div aria-hidden className="bg-grid absolute inset-0 opacity-15" />
            <div className="relative mx-auto max-w-2xl space-y-4">
              <h2 id="cta-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
                {h.cta.title}
              </h2>
              <p className="text-white/85">{h.cta.body}</p>
              <Button asChild size="lg" variant="secondary" className="mt-2">
                <Link href="/pricing">{h.cta.button}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile sticky CTA (UI_UX_SPEC.md) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 p-3 backdrop-blur md:hidden">
        <Button asChild variant="brand" className="w-full">
          <Link href="/app">{h.hero.primaryCta}</Link>
        </Button>
      </div>
      <div aria-hidden className="h-16 md:hidden" />
    </>
  );
}
