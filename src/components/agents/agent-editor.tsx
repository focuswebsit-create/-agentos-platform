"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { MODEL_PROVIDERS, hasConfiguredProvider } from "@/modules/agent-engine/model-registry";
import { sendJson } from "@/components/auth/api-client";
import type { AgentDraftConfig } from "@/modules/contracts";
import type { AgentDetail } from "@/modules/agents/data";
import type { Dictionary } from "@/i18n";

/**
 * Agent Studio's draft editor.
 *
 * The draft is saved leniently and validated strictly only at publish, which is
 * why the spend cap below is edited in dollars but held as an integer count of
 * micros: DATA_MODEL.md forbids floating point for money, and a float that
 * survives to a stored version would be a rounding error nobody can trace.
 */

const MICROS_PER_USD = 1_000_000;

/** Dollars to micros, rounded to the nearest cent first so 0.1 + 0.2 cannot leak in. */
function usdToMicros(input: string): number | null {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  const micros = Math.round(value * 100) * (MICROS_PER_USD / 100);
  return micros >= 1 && micros <= 100 * MICROS_PER_USD ? micros : null;
}
function microsToUsd(micros: number): string {
  return (micros / MICROS_PER_USD).toFixed(2);
}

export function AgentEditor({
  t,
  orgId,
  agent,
  canEdit,
  canPublish,
  canArchive,
}: {
  t: Dictionary;
  orgId: string;
  agent: AgentDetail;
  canEdit: boolean;
  canPublish: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const e = t.agents.editor;
  const archived = agent.status === "archived";
  const editable = canEdit && !archived;

  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [config, setConfig] = React.useState<AgentDraftConfig>(agent.draftConfig);
  const [spendUsd, setSpendUsd] = React.useState(microsToUsd(agent.draftConfig.maxSpendUsdMicros));

  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"save" | "publish" | "archive" | null>(null);

  const set = <K extends keyof AgentDraftConfig>(key: K, value: AgentDraftConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const models = React.useMemo(
    () => MODEL_PROVIDERS.find((p) => p.id === config.provider)?.models ?? [],
    [config.provider],
  );

  /** Returns whether everything was written, so publish can refuse to proceed. */
  async function saveDraft(announce = true): Promise<boolean> {
    setError(null);
    setNotice(null);

    const micros = usdToMicros(spendUsd);
    if (micros === null) {
      setError(e.maxSpendLabel);
      return false;
    }
    setPending("save");

    const details = await sendJson(`/api/agents/${agent.id}`, "PATCH", {
      orgId,
      name,
      description: description.trim() || null,
    });
    if (!details.ok) {
      setPending(null);
      setError(details.message ?? t.auth.errors.generic);
      return false;
    }

    const res = await sendJson(`/api/agents/${agent.id}/draft`, "PUT", {
      orgId,
      config: { ...config, maxSpendUsdMicros: micros },
    });
    setPending(null);
    if (!res.ok) {
      setError(res.message ?? t.auth.errors.generic);
      return false;
    }
    if (announce) setNotice(e.draftSaved);
    router.refresh();
    return true;
  }

  async function publish() {
    setError(null);
    setNotice(null);
    // Save first: publishing freezes what is STORED, not what is on screen, so
    // skipping this would publish a version missing the last edit. If the save
    // fails, stop — it has already set the error, and publishing stale content
    // after a failed write is the worst of the three outcomes.
    if (!(await saveDraft(false))) return;
    setPending("publish");

    const res = await sendJson<{ version: number }>(`/api/agents/${agent.id}/publish`, "POST", {
      orgId,
    });
    setPending(null);

    if (!res.ok) {
      // The server names the missing fields in `message`; showing it is the
      // only way the user learns what to fix.
      setError(res.message ?? t.auth.errors.generic);
      setNotice(null);
      return;
    }
    setNotice(e.published.replace("{n}", String(res.data.version)));
    router.refresh();
  }

  async function toggleArchive() {
    setError(null);
    setNotice(null);
    setPending("archive");
    const res = await sendJson(`/api/agents/${agent.id}/archive`, "POST", {
      orgId,
      archived: !archived,
    });
    setPending(null);
    if (!res.ok) {
      setError(t.auth.errors.generic);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {archived ? <FormAlert tone="error">{e.archivedNotice}</FormAlert> : null}
      {!canEdit ? <FormAlert tone="info">{e.readOnlyNotice}</FormAlert> : null}
      {/* Stated before anything is published, not after: an agent that cannot
          run is a definition, and presenting it as live would be a dummy
          result (CLAUDE.md rule 4). */}
      {!hasConfiguredProvider() ? <FormAlert tone="info">{e.noProviderNotice}</FormAlert> : null}
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{e.detailsHeading}</h2>
        <div className="space-y-4">
          <TextField
            id="agentName"
            label={t.agents.nameLabel}
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            disabled={!editable}
            minLength={2}
            maxLength={120}
          />
          <TextField
            id="agentDescription"
            label={t.agents.descriptionLabel}
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            disabled={!editable}
            maxLength={500}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{e.configHeading}</h2>
        <div className="space-y-4">
          <TextField
            id="agentRole"
            label={e.roleLabel}
            placeholder={e.rolePlaceholder}
            value={config.role}
            onChange={(ev) => set("role", ev.target.value)}
            disabled={!editable}
            maxLength={120}
          />

          <Field id="agentInstructions" label={e.instructionsLabel} hint={e.instructionsHint}>
            <Textarea
              id="agentInstructions"
              className="min-h-40"
              placeholder={e.instructionsPlaceholder}
              value={config.instructions}
              onChange={(ev) => set("instructions", ev.target.value)}
              disabled={!editable}
              maxLength={20_000}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Driven by the registry, never a hardcoded list (PRD section 9),
                and every option says plainly that it is not connected. A picker
                that looked ready would be a fictional integration. */}
            <Field id="agentProvider" label={e.providerLabel}>
              <NativeSelect
                id="agentProvider"
                value={config.provider}
                onChange={(ev) => {
                  set("provider", ev.target.value);
                  set("model", ""); // models belong to one provider
                }}
                disabled={!editable}
              >
                <option value="">{e.providerPlaceholder}</option>
                {MODEL_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.configured ? p.label : `${p.label} — ${e.providerNotConfigured}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="agentModel" label={e.modelLabel}>
              <NativeSelect
                id="agentModel"
                value={config.model}
                onChange={(ev) => set("model", ev.target.value)}
                disabled={!editable || models.length === 0}
              >
                <option value="">{e.modelPlaceholder}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <TextField
              id="agentMaxSteps"
              type="number"
              min={1}
              max={50}
              label={e.maxStepsLabel}
              value={String(config.maxSteps)}
              onChange={(ev) => set("maxSteps", Number(ev.target.value))}
              disabled={!editable}
            />
            <TextField
              id="agentMaxSpend"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              label={e.maxSpendLabel}
              hint={e.maxSpendHint}
              value={spendUsd}
              onChange={(ev) => setSpendUsd(ev.target.value)}
              disabled={!editable}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void saveDraft()}
          disabled={!editable || pending !== null}
        >
          {pending === "save" ? <Spinner label={e.savingDraft} /> : e.saveDraft}
        </Button>
        {canPublish ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void publish()}
            disabled={!editable || pending !== null}
          >
            {pending === "publish" ? <Spinner label={e.publishing} /> : e.publish}
          </Button>
        ) : null}
        {canArchive ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void toggleArchive()}
            disabled={pending !== null}
          >
            {archived ? e.restore : e.archive}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{e.publishHint}</p>

      <section className="rounded-2xl border bg-card shadow-sm">
        <h2 className="border-b px-5 py-4 text-base font-semibold">{e.historyHeading}</h2>
        {agent.history.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{e.historyEmpty}</p>
        ) : (
          <ul className="divide-y">
            {agent.history.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-4"
              >
                <span className="text-sm font-medium">
                  {t.agents.publishedVersion.replace("{n}", String(v.version))}
                </span>
                <span className="flex items-center gap-2">
                  {v.id === agent.activeVersionId ? (
                    <Badge variant="secondary">{e.activeBadge}</Badge>
                  ) : null}
                  <time
                    dateTime={v.publishedAt}
                    dir="ltr"
                    className="text-xs text-muted-foreground"
                  >
                    {v.publishedAt.slice(0, 16).replace("T", " ")}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
