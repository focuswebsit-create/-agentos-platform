import type { LucideIcon } from "lucide-react";
import { InfoIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  info: { icon: InfoIcon, className: "border-primary/20 bg-primary/5 text-foreground" },
  demo: {
    icon: TriangleAlertIcon,
    className: "border-warning/40 bg-warning/10 text-foreground",
  },
  locked: { icon: LockIcon, className: "border-admin/40 bg-admin/10 text-foreground" },
} satisfies Record<string, { icon: LucideIcon; className: string }>;

/** Inline banner used for truthful status messages (demo, locked, not configured). */
export function Notice({
  variant = "info",
  children,
  className,
}: {
  variant?: keyof typeof VARIANTS;
  children: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: variantClass } = VARIANTS[variant];
  return (
    <div
      role="note"
      data-notice={variant}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed",
        variantClass,
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 opacity-80" />
      <div>{children}</div>
    </div>
  );
}
