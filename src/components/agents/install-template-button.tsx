"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

export function InstallTemplateButton({
  t,
  orgId,
  versionId,
  onError,
}: {
  t: Dictionary;
  orgId: string;
  versionId: string;
  /** Lifted so one alert is shown for the page, not one per card. */
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function install() {
    onError("");
    setPending(true);

    const res = await sendJson<{ agentId: string }>(`/api/templates/${versionId}/install`, "POST", {
      orgId,
    });

    if (!res.ok) {
      setPending(false);
      onError(
        res.code === "TEMPLATE_NOT_AVAILABLE"
          ? t.templates.unavailable
          : res.code === "ORG_ACCESS_DENIED"
            ? t.templates.noInstallPermission
            : t.auth.errors.generic,
      );
      return;
    }

    // Stays pending through the navigation: re-enabling now would let a second
    // click install the same template twice, which the database permits.
    router.push(`/app/agents/${res.data.agentId}`);
  }

  return (
    <Button type="button" variant="outline" onClick={() => void install()} disabled={pending}>
      {pending ? <Spinner label={t.templates.installing} /> : t.templates.install}
    </Button>
  );
}
