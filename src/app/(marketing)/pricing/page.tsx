import type { Metadata } from "next";
import { CircleDollarSignIcon } from "lucide-react";
import { PricingTable } from "@/components/marketing/pricing-table";
import { Notice } from "@/components/shared/notice";
import { DEFAULT_LOCALE, getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: t.pricing.title,
  description: t.pricing.subtitle,
};

export default function PricingPage() {
  const p = t.pricing;
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-2xl animate-fade-up space-y-4 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          <span className="text-gradient-brand">{p.title}</span>
        </h1>
        <p className="text-lg text-muted-foreground">{p.subtitle}</p>
      </div>

      <Notice variant="demo" className="mx-auto mt-8 max-w-3xl">
        <strong className="font-semibold">{p.plannedBanner}</strong>
      </Notice>

      <div className="mt-12">
        <PricingTable t={t} locale={DEFAULT_LOCALE} />
      </div>

      <section
        aria-labelledby="budget-title"
        className="mx-auto mt-16 flex max-w-3xl gap-4 rounded-2xl border bg-muted/30 p-6"
      >
        <CircleDollarSignIcon aria-hidden className="mt-1 size-6 shrink-0 text-primary" />
        <div className="space-y-2">
          <h2 id="budget-title" className="text-lg font-semibold">
            {p.budgetExplainer.title}
          </h2>
          <p className="leading-relaxed text-muted-foreground">{p.budgetExplainer.body}</p>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mx-auto mt-16 max-w-3xl">
        <h2 id="faq-title" className="mb-6 text-2xl font-bold">
          {p.faq.title}
        </h2>
        <div className="divide-y rounded-2xl border bg-card">
          {p.faq.items.map((item) => (
            <details key={item.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {item.q}
                <span
                  aria-hidden
                  className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
