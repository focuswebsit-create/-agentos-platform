import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Truthful empty state (UI_UX_SPEC.md): explains why there is nothing here and
 * what will make it appear. Never shows invented data.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  phaseLabel,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  phaseLabel?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="empty-state"
      aria-label={title}
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center",
        className,
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-brand-blue/12 via-brand-indigo/12 to-brand-violet/12 text-primary ring-1 ring-primary/10">
        <Icon aria-hidden className="size-6" />
      </span>
      <div className="max-w-md space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {phaseLabel ? <Badge variant="muted">{phaseLabel}</Badge> : null}
      {action}
    </section>
  );
}
