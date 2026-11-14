"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authFailureMessage, callAuth } from "./auth-client";
import { ResetPasswordSchema } from "@/modules/contracts";
import type { Dictionary } from "@/i18n";
import { FormAlert, PasswordField, Spinner } from "./form-parts";

/**
 * Choosing a new password.
 *
 * Reaching this screen requires the recovery session created by the emailed
 * link. Without one the form is not rendered at all: there would be nothing to
 * update, and showing it would invite people to type a new password into a
 * page that cannot save it.
 */
export function ResetPasswordForm({ t }: { t: Dictionary }) {
  const router = useRouter();
  const [checking, setChecking] = React.useState(true);
  const [hasSession, setHasSession] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // A rejected promise inside an effect is an unhandled rejection, which
    // takes the whole tree down and shows the browser's "page couldn't load"
    // screen. A network failure or a hang here must degrade to "no recovery
    // session", which renders the "ask for a new link" message instead.
    (async () => {
      // Through callAuth so a request that never answers cannot leave
      // `checking` true: the try/catch below handles a rejection, but it does
      // nothing about a hang, and a hang here is the same infinite spinner
      // from the other direction.
      const result = await callAuth((supabase) => supabase.auth.getClaims());
      if (cancelled) return;
      setHasSession(result.ok ? Boolean(result.data.data?.claims?.sub) : false);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = ResetPasswordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      setErrors({
        password: issues.some((i) => i.path[0] === "password")
          ? t.auth.errors.passwordTooShort
          : undefined,
        confirm: issues.some((i) => i.path[0] === "confirm")
          ? t.auth.errors.passwordsDoNotMatch
          : undefined,
      });
      return;
    }
    setErrors({});
    setPending(true);

    const result = await callAuth((supabase) =>
      supabase.auth.updateUser({ password: parsed.data.password }),
    );
    setPending(false);

    if (!result.ok) {
      setFormError(authFailureMessage(result, t.auth.errors));
      return;
    }

    const { error } = result.data;
    if (error) {
      setFormError(error.status === 429 ? t.auth.errors.rateLimited : t.auth.errors.generic);
      return;
    }

    // Sign out everywhere: a password reset usually follows a suspected
    // compromise, so leaving other sessions alive would defeat the point.
    //
    // A failure here is not reported and does not block: the password HAS been
    // changed, and telling the user it failed would send them to try again
    // with a password that no longer works. The other sessions expire on their
    // own refresh, which will fail against the new credential.
    await callAuth((supabase) => supabase.auth.signOut({ scope: "global" }));
    setDone(true);
    router.refresh();
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner label={t.auth.working} />
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{t.auth.reset.success}</FormAlert>
        <Button asChild variant="brand" size="lg" className="w-full">
          <Link href="/sign-in">{t.auth.signIn.submit}</Link>
        </Button>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <FormAlert tone="error">{t.auth.reset.linkInvalid}</FormAlert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/forgot-password">{t.auth.forgot.submit}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
      <PasswordField
        id="password"
        label={t.auth.reset.newPassword}
        autoComplete="new-password"
        dir="ltr"
        placeholder={t.auth.passwordPlaceholder}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        showLabel={t.auth.show}
        hideLabel={t.auth.hide}
        required
      />
      <PasswordField
        id="confirm"
        label={t.auth.reset.confirmPassword}
        autoComplete="new-password"
        dir="ltr"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
        showLabel={t.auth.show}
        hideLabel={t.auth.hide}
        required
      />
      <Button type="submit" variant="brand" size="lg" className="w-full gap-2" disabled={pending}>
        {pending ? <Spinner label={t.auth.working} /> : t.auth.reset.submit}
      </Button>
    </form>
  );
}
