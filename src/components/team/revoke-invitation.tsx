"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import type { Dictionary } from "@/i18n";

function readCsrfToken(): string {
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

export function RevokeInvitation({
  t,
  orgId,
  invitationId,
}: {
  t: Dictionary;
  orgId: string;
  invitationId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function revoke() {
    setPending(true);
    await fetch(`/api/invitations/${invitationId}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ orgId }),
    });
    setPending(false);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={pending}
      onClick={revoke}
    >
      {pending ? t.team.revoking : t.team.revoke}
    </Button>
  );
}
