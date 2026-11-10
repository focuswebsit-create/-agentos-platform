import { FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Visible marker for any demo / illustrative / not-yet-real content. */
export function DemoBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="demo" className={className} data-demo="true">
      <FlaskConicalIcon aria-hidden />
      {label}
    </Badge>
  );
}
