"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

/**
 * Suspend from new runs, or restore.
 *
 * The reason field is required by the server and by the database, so it is a
 * required input here too rather than an optional note. `SUPER_ADMIN.md` asks
 * for a reason because a suspension nobody can explain later is indistinguishable
 * from an outage.
 */
export function SuspendOrgControl({
  t,
  orgId,
  suspended,
}: {
  t: Dictionary;
  orgId: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const s = t.admin.sections.organizations;
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  // Kept local rather than lifted to the page. The page is a server component
  // rendering a table; lifting this would mean wrapping the whole table in a
  // client boundary to carry one string, and an error belongs next to the row
  // that produced it anyway.
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setError(null);
    setPending(true);
    const res = await sendJson(
      `/api/admin/organizations/${orgId}`,
      "PATCH",
      suspended ? { suspended: false } : { suspended: true, reason },
    );
    setPending(false);
    if (!res.ok) {
      setError(res.message ?? t.auth.errors.generic);
      return;
    }
    setReason("");
    router.refresh();
  }

  if (suspended) {
    return (
      <span className="flex flex-col items-start gap-1">
        <Button type="button" variant="outline" disabled={pending} onClick={() => void submit()}>
          {pending ? <Spinner label={s.working} /> : s.restore}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
      <Input
        className="h-9 w-56"
        aria-label={s.reasonLabel}
        placeholder={s.reasonPlaceholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        disabled={pending}
      />
      <Button
        type="button"
        variant="outline"
        disabled={pending || reason.trim().length < 3}
        onClick={() => void submit()}
      >
        {pending ? <Spinner label={s.working} /> : s.suspend}
      </Button>
    </span>
  );
}
