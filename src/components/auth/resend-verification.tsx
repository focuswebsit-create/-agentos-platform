"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { authFailureMessage, callAuth } from "./auth-client";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner } from "./form-parts";

export function ResendVerification({ t, email }: { t: Dictionary; email: string | null }) {
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!email) return null;

  async function resend() {
    if (!email) return;
    setPending(true);
    setError(null);

    const result = await callAuth((supabase) =>
      supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app` },
      }),
    );

    setPending(false);

    // A transport failure is reported; the Supabase-level outcome is not.
    // Whether the request reached the server is independent of whether the
    // address is registered, so saying so leaks nothing - and telling someone
    // mail is on its way when nothing was sent wastes a real wait.
    if (!result.ok) {
      setError(authFailureMessage(result, t.auth.errors));
      return;
    }
    setSent(true);
  }

  return (
    <div className="space-y-3">
      {sent ? <FormAlert tone="success">{t.auth.verifyEmail.resent}</FormAlert> : null}
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button
        onClick={resend}
        variant="outline"
        className="w-full gap-2"
        disabled={pending || sent}
      >
        {pending ? <Spinner label={t.auth.working} /> : t.auth.verifyEmail.resend}
      </Button>
    </div>
  );
}
