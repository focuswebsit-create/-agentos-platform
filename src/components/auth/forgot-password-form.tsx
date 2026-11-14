"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/modules/supabase/browser";
import { ForgotPasswordSchema } from "@/modules/contracts";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner, TextField } from "./form-parts";

export function ForgotPasswordForm({ t }: { t: Dictionary }) {
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [sent, setSent] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ForgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(t.auth.errors.emailInvalid);
      return;
    }
    setEmailError(undefined);
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    // The same confirmation is shown whether or not an account exists, and any
    // error is swallowed for the same reason: a different response here would
    // reveal which addresses are registered.
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{t.auth.forgot.sent}</FormAlert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">{t.auth.forgot.backToSignIn}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        id="email"
        label={t.auth.emailLabel}
        type="email"
        inputMode="email"
        autoComplete="email"
        dir="ltr"
        placeholder={t.auth.emailPlaceholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={emailError}
        required
      />
      <Button type="submit" variant="brand" size="lg" className="w-full gap-2" disabled={pending}>
        {pending ? <Spinner label={t.auth.working} /> : t.auth.forgot.submit}
      </Button>
      <p className="text-center text-sm">
        <Link
          href="/sign-in"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          {t.auth.forgot.backToSignIn}
        </Link>
      </p>
    </form>
  );
}
