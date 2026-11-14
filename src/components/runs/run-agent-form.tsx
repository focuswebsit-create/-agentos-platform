"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, Spinner } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

/**
 * The test playground (PRD.md section 5).
 *
 * Disabled, with the reason stated, whenever running is impossible: no
 * published version, no configured provider, or a viewer's role. A button that
 * looks ready and then fails teaches people that the product is broken; a
 * button that says why it is off teaches them what to do next.
 */
export function RunAgentForm({
  t,
  orgId,
  agentId,
  canRun,
  isPublished,
  providerConfigured,
}: {
  t: Dictionary;
  orgId: string;
  agentId: string;
  canRun: boolean;
  isPublished: boolean;
  providerConfigured: boolean;
}) {
  const router = useRouter();
  const p = t.runs.playground;
  const [prompt, setPrompt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const blocked = !canRun
    ? p.noPermission
    : !isPublished
      ? p.needsPublish
      : !providerConfigured
        ? p.noProvider
        : null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const res = await sendJson<{ runId: string }>(`/api/agents/${agentId}/run`, "POST", {
      orgId,
      prompt,
    });

    if (!res.ok) {
      setPending(false);
      setError(res.message ?? t.auth.errors.generic);
      return;
    }
    // Stays pending through the navigation, so a second click cannot dispatch
    // a second run that also costs money.
    router.push(`/app/runs/${res.data.runId}`);
  }

  if (blocked) return <FormAlert tone="info">{blocked}</FormAlert>;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Field id="runPrompt" label={p.inputLabel}>
        <Textarea
          id="runPrompt"
          placeholder={p.inputPlaceholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={10_000}
          disabled={pending}
        />
      </Field>
      <Button type="submit" disabled={pending || prompt.trim().length === 0}>
        {pending ? <Spinner label={p.running} /> : p.submit}
      </Button>
    </form>
  );
}
