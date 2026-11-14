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
  simulation = false,
  runtimeConfigured = true,
}: {
  t: Dictionary;
  orgId: string;
  agentId: string;
  canRun: boolean;
  isPublished: boolean;
  providerConfigured: boolean;
  /** The published version runs on the simulation provider. Said up front. */
  simulation?: boolean;
  /** The server can record and settle runs. Without it, nothing may be dispatched. */
  runtimeConfigured?: boolean;
}) {
  const router = useRouter();
  const p = t.runs.playground;
  const [prompt, setPrompt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"published" | "draft" | null>(null);

  // Two independent questions. Testing the saved draft needs only permission
  // and a runtime: it works before the first publish, which is the point.
  // Running the published version additionally needs one, on a configured
  // provider. The server re-checks every one of these.
  const blocked = !canRun ? p.noPermission : !runtimeConfigured ? p.noRuntime : null;
  const publishedBlocked = !isPublished
    ? p.needsPublish
    : !providerConfigured
      ? p.noProvider
      : null;

  async function dispatch(target: "published" | "draft") {
    setError(null);
    setPending(target);

    const url =
      target === "draft" ? `/api/agents/${agentId}/test-run` : `/api/agents/${agentId}/run`;
    const res = await sendJson<{ runId: string }>(url, "POST", { orgId, prompt });

    if (!res.ok) {
      setPending(null);
      setError(res.message ?? t.auth.errors.generic);
      return;
    }
    // Stays pending through the navigation, so a second click cannot dispatch
    // a second run that also costs money.
    router.push(`/app/runs/${res.data.runId}`);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publishedBlocked) void dispatch("published");
  }

  if (blocked) return <FormAlert tone="info">{blocked}</FormAlert>;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormAlert tone="info">{simulation ? p.simulationNotice : p.realProviderNotice}</FormAlert>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {publishedBlocked ? <FormAlert tone="info">{publishedBlocked}</FormAlert> : null}
      <Field id="runPrompt" label={p.inputLabel}>
        <Textarea
          id="runPrompt"
          placeholder={p.inputPlaceholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={10_000}
          disabled={pending !== null}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={pending !== null || prompt.trim().length === 0 || publishedBlocked !== null}
        >
          {pending === "published" ? <Spinner label={p.running} /> : p.submit}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid="test-draft"
          onClick={() => void dispatch("draft")}
          disabled={pending !== null || prompt.trim().length === 0}
        >
          {pending === "draft" ? <Spinner label={p.running} /> : p.testDraft}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{p.testDraftHint}</p>
    </form>
  );
}
