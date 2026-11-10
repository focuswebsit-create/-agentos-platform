import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** KPI tile that renders an explicit empty value until real data exists. */
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
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
        <p className="text-3xl font-semibold tracking-tight text-muted-foreground/70 tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
