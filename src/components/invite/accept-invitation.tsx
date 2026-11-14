"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner } from "@/components/auth/form-parts";

function readCsrfToken(): string {
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

export function AcceptInvitation({ t, token }: { t: Dictionary; token: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);

    const res = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      setPending(false);
      const payload = (await res.json().catch(() => null)) as { code?: string } | null;
      // The server returns one generic code for every invitation failure, so
      // this screen cannot reveal whether a token exists, has expired, or was
      // addressed to somebody else.
      if (payload?.code === "EMAIL_NOT_VERIFIED") setError(t.invite.verifyFirst);
      else if (payload?.code === "SEAT_LIMIT_REACHED") setError(t.team.seatsFull);
      else if (payload?.code === "AUTH_REQUIRED") setError(t.invite.signInFirst);
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
