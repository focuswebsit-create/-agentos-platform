"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { OrgRole } from "@/modules/tenancy";
import type { Dictionary } from "@/i18n";
import { sendJson } from "@/components/auth/api-client";

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
    const res = await sendJson(`/api/memberships/${targetUserId}`, "PATCH", { orgId, role: next });
    setPending(null);
    if (!res.ok) {
      onError(res.code === "ORG_ACCESS_DENIED" ? t.team.cannotActOnSelf : t.auth.errors.generic);
      return;
    }
    router.refresh();
  }

  async function remove() {
    setPending("remove");
    const res = await sendJson(`/api/memberships/${targetUserId}`, "DELETE", { orgId });
    setPending(null);
    if (!res.ok) {
      onError(res.code === "ORG_ACCESS_DENIED" ? t.team.lastOwner : t.auth.errors.generic);
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
