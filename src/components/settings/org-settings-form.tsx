"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

export function OrgSettingsForm({
  t,
  orgId,
  initial,
  canEdit,
}: {
  t: Dictionary;
  orgId: string;
  initial: { name: string; locale: "he" | "en"; timezone: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [locale, setLocale] = React.useState<"he" | "en">(initial.locale);
  const [timezone, setTimezone] = React.useState(initial.timezone);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // Offer the zones the runtime actually knows, so a value cannot be saved
  // that the browser then fails to format with.
  const zones = React.useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return supported.length > 0 ? supported : [initial.timezone];
  }, [initial.timezone]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);

    const res = await sendJson("/api/orgs", "PATCH", { orgId, name, locale, timezone });
    setPending(false);

    if (!res.ok) {
      setError(
        res.code === "ORG_ACCESS_DENIED" ? t.orgSettings.noPermission : t.auth.errors.generic,
      );
      return;
    }
    setSaved(true);
    router.refresh();
  }

  if (!canEdit) {
    return <FormAlert tone="error">{t.orgSettings.noPermission}</FormAlert>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {saved ? <FormAlert tone="success">{t.orgSettings.saved}</FormAlert> : null}

      <TextField
        id="orgName"
        label={t.orgSettings.nameLabel}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="orgLocale" className="text-sm font-medium">
            {t.orgSettings.localeLabel}
          </label>
          <NativeSelect
            id="orgLocale"
            value={locale}
            onChange={(e) => setLocale(e.target.value as "he" | "en")}
          >
            <option value="he">{t.orgSettings.locales.he}</option>
            <option value="en">{t.orgSettings.locales.en}</option>
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="orgTimezone" className="text-sm font-medium">
            {t.orgSettings.timezoneLabel}
          </label>
          <NativeSelect
            id="orgTimezone"
            dir="ltr"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <Button type="submit" variant="brand" className="gap-2" disabled={pending}>
        {pending ? <Spinner label={t.orgSettings.saving} /> : t.orgSettings.save}
      </Button>
    </form>
  );
}
