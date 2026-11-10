import {
  ArrowDownIcon,
  ArrowLeftIcon,
  FileTextIcon,
  PenLineIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DemoBadge } from "@/components/shared/demo-badge";
import type { Dictionary } from "@/i18n";
import { cn } from "@/lib/utils";

const AGENT_ICONS: readonly LucideIcon[] = [SearchIcon, PenLineIcon, ShieldCheckIcon];
const AGENT_TINTS = [
  "from-brand-blue/15 to-brand-blue/5 text-brand-blue",
  "from-brand-indigo/15 to-brand-indigo/5 text-brand-indigo",
  "from-brand-violet/15 to-brand-violet/5 text-brand-violet",
];

function Connector() {
  return (
    <span aria-hidden className="flex items-center justify-center text-muted-foreground/60">
      <ArrowLeftIcon className="size-4 -rotate-90 sm:rotate-0 ltr:sm:rotate-180" />
    </span>
  );
}

/**
 * Static illustration of a sequential agent team (Research → Writer → Reviewer).
 * Purely visual: no run, no data. Labeled as an illustration.
 */
export function AgentTeamDiagram({ t }: { t: Dictionary }) {
  const d = t.home.diagram;
  return (
    <figure
      aria-labelledby="diagram-caption"
      className="relative overflow-hidden rounded-3xl border bg-card/80 p-5 shadow-xl shadow-brand-indigo/5 backdrop-blur sm:p-7"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{d.title}</p>
        <DemoBadge label={t.common.illustration} />
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
        <FileTextIcon aria-hidden className="size-4 shrink-0" />
        {d.input}
      </div>
      <span aria-hidden className="flex justify-center py-1.5 text-muted-foreground/60">
        <ArrowDownIcon className="size-4" />
      </span>

      <ol className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {d.agents.map((agent, i) => {
          const Icon = AGENT_ICONS[i] ?? SparklesIcon;
          return (
            <li key={agent.name} className="contents">
              <div
                className="flex flex-1 animate-fade-up items-center gap-3 rounded-2xl border bg-background/70 p-3.5 shadow-sm sm:flex-col sm:items-start sm:gap-2.5"
                style={{ animationDelay: `${150 + i * 120}ms` }}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 animate-float items-center justify-center rounded-xl bg-linear-to-br",
                    AGENT_TINTS[i],
                  )}
                  style={{ animationDelay: `${i * 0.8}s` }}
                >
                  <Icon aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{agent.name}</p>
                  <p className="text-xs leading-snug text-muted-foreground">{agent.role}</p>
                </div>
              </div>
              {i < d.agents.length - 1 ? <Connector /> : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex flex-col gap-2 rounded-xl bg-muted/60 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <ShieldCheckIcon aria-hidden className="size-4 text-success" />
          {d.approval}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <SparklesIcon aria-hidden className="size-4" />
          {d.output}
        </span>
      </div>

      <figcaption id="diagram-caption" className="mt-4 text-xs text-muted-foreground">
        {d.caption}
      </figcaption>
    </figure>
  );
}
