"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import type { OrgRole } from "@/modules/tenancy";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner, TextField } from "@/components/auth/form-parts";

function readCsrfToken(): string {
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

export function InviteForm({
  t,
  orgId,
  assignable,
  seatsFull,
}: {
  t: Dictionary;
  orgId: string;
  assignable: readonly OrgRole[];
  seatsFull: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<OrgRole>(
    assignable.includes("member") ? "member" : assignable[0]!,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInviteUrl(null);
    setPending(true);

    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ email, role, orgId }),
    });
    setPending(false);

    const payload = (await res.json().catch(() => null)) as {
      inviteUrl?: string;
      code?: string;
    } | null;

    if (!res.ok) {
      if (payload?.code === "SEAT_LIMIT_REACHED") setError(t.team.seatsFull);
      else if (payload?.code === "VALIDATION_FAILED") setError(t.auth.errors.emailInvalid);
      else if (payload?.code === "ORG_ACCESS_DENIED") setError(t.team.cannotActOnSelf);
      else setError(t.auth.errors.generic);
      return;
    }

    setInviteUrl(payload?.inviteUrl ?? null);
    setEmail("");
    router.refresh();
  }

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Stated plainly: nothing is emailed. CLAUDE.md rule 4 forbids
          presenting an integration as operational when it is not. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-3 text-sm">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="leading-relaxed text-muted-foreground">{t.team.emailNotActive}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}

        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <TextField
            id="inviteEmail"
            label={t.team.inviteEmail}
            type="email"
            inputMode="email"
            dir="ltr"
            placeholder={t.auth.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={seatsFull}
          />
          <div className="space-y-1.5">
            <label htmlFor="inviteRole" className="text-sm font-medium">
              {t.team.inviteRole}
            </label>
            <NativeSelect
              id="inviteRole"
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              disabled={seatsFull}
            >
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {t.team.roles[r]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t.team.roleHints[role]}</p>

        <Button type="submit" variant="brand" className="gap-2" disabled={pending || seatsFull}>
          {pending ? <Spinner label={t.team.inviteCreating} /> : t.team.inviteSubmit}
        </Button>
        {seatsFull ? <p className="text-sm text-destructive">{t.team.seatsFull}</p> : null}
      </form>

      {inviteUrl ? (
        <div className="space-y-2.5 rounded-xl border border-success/30 bg-success/5 p-4">
          <p className="text-sm font-medium text-success">{t.team.linkReady}</p>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-lg border bg-card px-3 py-2 font-mono text-xs"
            >
              {inviteUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copy}
              className="shrink-0 gap-1.5"
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              {copied ? t.team.copied : t.team.copyLink}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.team.linkShownOnce}</p>
        </div>
      ) : null}
    </div>
  );
}
