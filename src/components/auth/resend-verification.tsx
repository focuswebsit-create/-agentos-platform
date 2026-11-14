"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/modules/supabase/browser";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner } from "./form-parts";

export function ResendVerification({ t, email }: { t: Dictionary; email: string | null }) {
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  if (!email) return null;

  async function resend() {
    if (!email) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app` },
    });
    // Outcome is not surfaced: whether the address is registered must stay
    // unobservable from here.
    setPending(false);
    setSent(true);
  }

  return (
    <div className="space-y-3">
      {sent ? <FormAlert tone="success">{t.auth.verifyEmail.resent}</FormAlert> : null}
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
