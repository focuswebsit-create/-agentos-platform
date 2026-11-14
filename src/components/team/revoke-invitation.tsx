"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n";
import { sendJson } from "@/components/auth/api-client";

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
    await sendJson(`/api/invitations/${invitationId}/revoke`, "POST", { orgId });
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
