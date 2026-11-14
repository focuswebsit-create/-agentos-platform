"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/modules/supabase/browser";
import { SignUpSchema } from "@/modules/contracts";
import type { Dictionary } from "@/i18n";
import { FormAlert, PasswordField, Spinner, TextField } from "./form-parts";

export function SignUpForm({ t }: { t: Dictionary }) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = SignUpSchema.safeParse({ email, password, displayName });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        displayName: flat.displayName?.length ? t.auth.errors.displayNameRequired : undefined,
        email: flat.email?.length ? t.auth.errors.emailInvalid : undefined,
        password: flat.password?.length ? t.auth.errors.passwordTooShort : undefined,
      });
      return;
    }
    setFieldErrors({});
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // Read by the handle_new_user trigger to seed public.profiles, so a
        // member list shows a name instead of an email local part.
        data: { display_name: parsed.data.displayName },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
      },
    });

    if (error) {
      setPending(false);
      if (error.status === 429) setFormError(t.auth.errors.rateLimited);
      else if (error.code === "signup_disabled") setFormError(t.auth.errors.signUpDisabled);
      else setFormError(t.auth.errors.generic);
      return;
    }

    // Email confirmation is required (mailer_autoconfirm is off), so there is
    // no session yet. Never auto-sign-in here: that would defeat confirmation.
    router.replace(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}

      <TextField
        id="displayName"
        label={t.auth.displayNameLabel}
        autoComplete="name"
        placeholder={t.auth.displayNamePlaceholder}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        error={fieldErrors.displayName}
        required
      />

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
        error={fieldErrors.email}
        required
      />

      <PasswordField
        id="password"
        label={t.auth.passwordLabel}
        autoComplete="new-password"
        dir="ltr"
        placeholder={t.auth.passwordPlaceholder}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        showLabel={t.auth.show}
        hideLabel={t.auth.hide}
        required
      />

      <Button type="submit" variant="brand" size="lg" className="w-full gap-2" disabled={pending}>
        {pending ? <Spinner label={t.auth.working} /> : t.auth.signUp.submit}
      </Button>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {t.auth.signUp.terms}
      </p>

      <p className="text-center text-sm text-muted-foreground">
        {t.auth.signUp.haveAccount}{" "}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          {t.auth.signUp.signInLink}
        </Link>
      </p>
    </form>
  );
}
