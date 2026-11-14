"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner } from "@/components/auth/form-parts";
import { NETWORK_ERROR_STATUS, sendJson } from "@/components/auth/api-client";

export function AcceptInvitation({ t, token }: { t: Dictionary; token: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);

    const res = await sendJson("/api/invitations/accept", "POST", { token });

    if (!res.ok) {
      setPending(false);
      // The server returns one generic code for every invitation failure, so
      // this screen cannot reveal whether a token exists, has expired, or was
      // addressed to somebody else.
      if (res.status === NETWORK_ERROR_STATUS) setError(t.auth.errors.generic);
      else if (res.code === "EMAIL_NOT_VERIFIED") setError(t.invite.verifyFirst);
      else if (res.code === "SEAT_LIMIT_REACHED") setError(t.team.seatsFull);
      else if (res.code === "AUTH_REQUIRED") setError(t.invite.signInFirst);
      else setError(t.invite.invalid);
      return;
    }

    router.replace("/app");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button
        type="button"
        variant="brand"
        size="lg"
        className="w-full gap-2"
        onClick={accept}
        disabled={pending}
      >
        {pending ? <Spinner label={t.invite.joining} /> : t.invite.accept}
      </Button>
    </div>
  );
}
