import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-xl bg-linear-to-br from-brand-blue via-brand-indigo to-brand-violet shadow-md shadow-brand-indigo/30",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4.5 text-white" fill="none">
        <circle cx="6" cy="12" r="2.4" fill="currentColor" />
        <circle cx="18" cy="6.5" r="2.4" fill="currentColor" opacity="0.85" />
        <circle cx="18" cy="17.5" r="2.4" fill="currentColor" opacity="0.7" />
        <path
          d="M8.2 11 15.8 7.4M8.2 13l7.6 3.6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Logo({
  href = "/",
  label,
  className,
}: {
  href?: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2.5 rounded-lg font-latin", className)}
    >
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">{label}</span>
    </Link>
  );
}
