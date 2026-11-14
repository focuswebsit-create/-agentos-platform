import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI tile.
 *
 * `note` is what distinguishes a measured value from a placeholder. With a
 * note the number is dimmed, because a note means "this is not real data yet"
 * — an em dash plus "arrives in phase P3". Without one the number is a real
 * measurement and is rendered at full contrast, so the two can never be
 * confused at a glance.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Card className="gap-3 py-5 transition-shadow hover:shadow-md" data-testid="stat-card">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon aria-hidden className="size-4" />
          </span>
        </div>
        <p
          className={cn(
            "text-3xl font-semibold tracking-tight tabular-nums",
            note ? "text-muted-foreground/70" : "text-foreground",
          )}
        >
          {value}
        </p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
