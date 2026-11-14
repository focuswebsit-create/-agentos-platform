"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sendJson } from "@/components/auth/api-client";

export type WorkspaceOption = { orgId: string; orgName: string; role: string };

/**
 * Workspace switcher and sign-out.
 *
 * Switching is a POST carrying the double-submit CSRF token; the server
 * re-verifies membership before it writes the cookie, so this component
 * cannot grant access to anything by itself.
 */
export function WorkspaceMenu({
  current,
  options,
  roleLabels,
  signOutLabel,
}: {
  current: WorkspaceOption;
  options: readonly WorkspaceOption[];
  roleLabels: Record<string, string>;
  signOutLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function switchTo(orgId: string) {
    if (orgId === current.orgId) return setOpen(false);
    setPending(orgId);
    const res = await sendJson("/api/orgs/switch", "POST", { orgId });
    setPending(null);
    setOpen(false);
    if (res.ok) {
      // Full refresh: every server component on screen was rendered for the
      // previous organisation and must be re-fetched, not patched.
      router.refresh();
    }
  }

  const multiple = options.length > 1;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-card px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Building2Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{current.orgName}</p>
          <p className="text-xs text-muted-foreground">
            {roleLabels[current.role] ?? current.role}
          </p>
        </div>
        {multiple ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronsUpDownIcon className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open && multiple ? (
        <div
          role="menu"
          className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border bg-popover p-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.orgId}
              role="menuitem"
              type="button"
              disabled={pending !== null}
              onClick={() => switchTo(option.orgId)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-accent disabled:opacity-60",
                option.orgId === current.orgId && "font-medium",
              )}
            >
              <CheckIcon
                className={cn("size-4 shrink-0", option.orgId !== current.orgId && "opacity-0")}
                aria-hidden
              />
              <span className="truncate">{option.orgName}</span>
            </button>
          ))}
        </div>
      ) : null}

      <form action="/auth/sign-out" method="post" className="mt-2">
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
        >
          <LogOutIcon className="size-4 ltr:rotate-180" aria-hidden />
          {signOutLabel}
        </Button>
      </form>
    </div>
  );
}
