"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/modules/supabase/browser";
import { SignInSchema } from "@/modules/contracts";
import type { Dictionary } from "@/i18n";
import { FormAlert, PasswordField, Spinner, TextField } from "./form-parts";
import { safeNext } from "./safe-next";

export function SignInForm({ t }: { t: Dictionary }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = SignInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: flat.email?.length ? t.auth.errors.emailInvalid : undefined,
        password: flat.password?.length ? t.auth.errors.passwordTooShort : undefined,
      });
      return;
    }
    setFieldErrors({});
    setPending(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      setPending(false);
      const code = error.code ?? "";
      if (code === "email_not_confirmed") setFormError(t.auth.errors.emailNotConfirmed);
      else if (error.status === 429) setFormError(t.auth.errors.rateLimited);
      // Anything else is reported as "wrong email or password" on purpose:
      // distinguishing "no such user" would let anyone enumerate accounts.
      else setFormError(t.auth.errors.invalidCredentials);
      return;
    }

    // refresh() makes the server re-render with the new session cookies before
    // navigating, so the destination never renders in a signed-out state.
    router.replace(safeNext(params.get("next")));
    router.refresh();
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
        error={fieldErrors.email}
        required
      />

      <div className="space-y-1.5">
        <PasswordField
          id="password"
          label={t.auth.passwordLabel}
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          showLabel={t.auth.show}
          hideLabel={t.auth.hide}
          required
        />
        <div className="text-end">
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            {t.auth.signIn.forgot}
          </Link>
        </div>
      </div>

      <Button type="submit" variant="brand" size="lg" className="w-full gap-2" disabled={pending}>
        {pending ? <Spinner label={t.auth.working} /> : t.auth.signIn.submit}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t.auth.signIn.noAccount}{" "}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          {t.auth.signIn.signUpLink}
        </Link>
      </p>
    </form>
  );
}
