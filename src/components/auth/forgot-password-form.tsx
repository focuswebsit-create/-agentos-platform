"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authFailureMessage, callAuth } from "./auth-client";
import { ForgotPasswordSchema } from "@/modules/contracts";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner, TextField } from "./form-parts";

export function ForgotPasswordForm({ t }: { t: Dictionary }) {
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [formError, setFormError] = React.useState<string | null>(null);
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
    setFormError(null);
    setPending(true);

    const result = await callAuth((supabase) =>
      supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      }),
    );

    setPending(false);

    // A transport failure is reported; a Supabase-level error is not.
    //
    // The enumeration defence is "the same answer whether or not the account
    // exists". Whether the request reached the server at all is independent of
    // that, and leaks nothing. Claiming "check your inbox" while the service is
    // unreachable is a lie that costs the user a real wait for mail that is
    // never coming.
    if (!result.ok) {
      setFormError(authFailureMessage(result, t.auth.errors));
      return;
    }

    // Reached here, the outcome IS swallowed, deliberately: a different
    // response for a registered and an unregistered address would reveal which
    // is which.
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
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
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
