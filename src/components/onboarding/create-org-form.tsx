"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CreateOrgSchema, slugifyOrgName } from "@/modules/contracts";
import type { Dictionary } from "@/i18n";
import { FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";

export function CreateOrgForm({ t }: { t: Dictionary }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<{ name?: string; slug?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // Suggest a slug while the user has not chosen one. A Hebrew name yields
  // nothing usable, so the field stays empty and the user fills it in rather
  // than being handed a mangled transliteration.
  const effectiveSlug = slugTouched ? slug : slugifyOrgName(name);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = CreateOrgSchema.safeParse({ name, slug: effectiveSlug });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({
        name: flat.name?.length ? t.auth.errors.displayNameRequired : undefined,
        slug: flat.slug?.length ? t.auth.orgSlugHint : undefined,
      });
      return;
    }
    setErrors({});
    setPending(true);

    const res = await sendJson("/api/orgs", "POST", parsed.data);

    if (!res.ok) {
      setPending(false);
      if (res.code === "ORG_SLUG_TAKEN") setErrors({ slug: t.onboarding.slugTaken });
      else if (res.code === "EMAIL_NOT_VERIFIED") setFormError(t.auth.errors.emailNotConfirmed);
      else setFormError(t.auth.errors.generic);
      return;
    }

    router.replace("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}

      <TextField
        id="orgName"
        label={t.auth.orgNameLabel}
        placeholder={t.auth.orgNamePlaceholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        autoComplete="organization"
        required
      />

      <TextField
        id="orgSlug"
        label={t.auth.orgSlugLabel}
        hint={t.auth.orgSlugHint}
        dir="ltr"
        placeholder="my-business"
        value={effectiveSlug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value);
        }}
        error={errors.slug}
        required
      />

      <Button type="submit" variant="brand" size="lg" className="w-full gap-2" disabled={pending}>
        {pending ? <Spinner label={t.onboarding.creating} /> : t.onboarding.submit}
      </Button>
    </form>
  );
}
