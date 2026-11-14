"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A labelled field that announces its own error to assistive technology. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive"
        >
          <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  id,
  label,
  error,
  hint,
  ...props
}: React.ComponentProps<"input"> & { id: string; label: string; error?: string; hint?: string }) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
    </Field>
  );
}

export function PasswordField({
  id,
  label,
  error,
  hint,
  showLabel,
  hideLabel,
  ...props
}: React.ComponentProps<"input"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          className="pe-10"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          className="absolute end-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
    </Field>
  );
}

export function FormAlert({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const Icon = tone === "error" ? AlertCircleIcon : tone === "info" ? InfoIcon : CheckCircle2Icon;
  return (
    <div
      // Only an error interrupts a screen reader. "You have read-only access"
      // is context, and announcing it assertively would talk over the user.
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : tone === "info"
            ? "border-border bg-muted/50 text-muted-foreground"
            : "border-success/30 bg-success/5 text-success",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <>
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </>
  );
}
