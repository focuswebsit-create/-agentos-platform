"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import type { OrgRole } from "@/modules/tenancy";
import type { Dictionary } from "@/i18n";

function readCsrfToken(): string {
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

/**
 * Role change and removal.
 *
 * Which controls appear is decided on the SERVER and passed in; this component
 * only renders what it is given. Hiding a button is a courtesy, never a
 * control — the API guard and the RLS policy both refuse the same operations
 * whether or not the button was on screen.
 */
export function MemberActions({
  t,
  orgId,
  targetUserId,
  targetRole,
  assignable,
  canRemove,
  onError,
}: {
  t: Dictionary;
  orgId: string;
  targetUserId: string;
  targetRole: OrgRole;
  assignable: readonly OrgRole[];
  canRemove: boolean;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<"role" | "remove" | null>(null);

  async function changeRole(next: string) {
    if (next === targetRole) return;
    setPending("role");
    const res = await fetch(`/api/memberships/${targetUserId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ orgId, role: next }),
    });
    setPending(null);
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { code?: string } | null;
      onError(
        payload?.code === "ORG_ACCESS_DENIED" ? t.team.cannotActOnSelf : t.auth.errors.generic,
      );
      return;
    }
    router.refresh();
  }

  async function remove() {
    setPending("remove");
    const res = await fetch(`/api/memberships/${targetUserId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ orgId }),
    });
    setPending(null);
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { code?: string } | null;
      onError(payload?.code === "ORG_ACCESS_DENIED" ? t.team.lastOwner : t.auth.errors.generic);
      return;
    }
    router.refresh();
  }

  if (assignable.length === 0 && !canRemove) return null;

  return (
    <div className="flex items-center gap-2">
      {assignable.length > 0 ? (
        <NativeSelect
          aria-label={t.team.changeRole}
          value={targetRole}
          disabled={pending !== null}
          onChange={(e) => changeRole(e.target.value)}
          className="h-9 w-auto min-w-28 text-xs"
        >
          {/* The current role is listed so the control shows state, even when
              it is not one the actor could assign. */}
          {!assignable.includes(targetRole) ? (
            <option value={targetRole}>{t.team.roles[targetRole]}</option>
          ) : null}
          {assignable.map((r) => (
            <option key={r} value={r}>
              {t.team.roles[r]}
            </option>
          ))}
        </NativeSelect>
      ) : null}

      {canRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={pending !== null}
          onClick={remove}
        >
          {pending === "remove" ? t.team.removing : t.team.remove}
        </Button>
      ) : null}
    </div>
  );
}
