"use client";

import * as React from "react";
import {
  BrainCircuitIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FileTextIcon,
  GaugeIcon,
  LockIcon,
  PlayIcon,
  SaveIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { MODEL_PROVIDERS, hasConfiguredProvider } from "@/modules/agent-engine/model-registry";
import { TOOL_CATALOG } from "@/modules/agent-engine/tools";
import { validateStudioDraft, type StudioDraft } from "./studio-draft";

export type StudioCopy = Dictionary["studio"] & { preview: string };

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon aria-hidden className="size-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

const firstProvider = MODEL_PROVIDERS[0];

const INITIAL_DRAFT: StudioDraft = {
  name: "",
  role: "",
  instructions: "",
  provider: firstProvider?.id ?? "",
  model: firstProvider?.models[0]?.id ?? "",
  tools: [],
  maxSteps: 8,
  maxSpendUsd: 0.5,
};

/**
 * Agent Studio — P0 UI simulation. Local state only: nothing is saved, published,
 * or sent to any model. Save/Publish/Run are disabled with an explicit reason.
 */
export function AgentStudioPreview({ copy }: { copy: StudioCopy }) {
  const [draft, setDraft] = React.useState<StudioDraft>(INITIAL_DRAFT);
  const [testInput, setTestInput] = React.useState("");
  const providerReady = hasConfiguredProvider();
  const validation = validateStudioDraft(draft);
  const provider = MODEL_PROVIDERS.find((p) => p.id === draft.provider);

  const update = <K extends keyof StudioDraft>(key: K, value: StudioDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const toggleTool = (toolKey: string, risk: StudioDraft["tools"][number]["risk"]) =>
    setDraft((d) => ({
      ...d,
      tools: d.tools.some((x) => x.toolKey === toolKey)
        ? d.tools.filter((x) => x.toolKey !== toolKey)
        : [...d.tools, { toolKey, risk }],
    }));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <form
        aria-label={copy.title}
        className="space-y-6"
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <Section icon={UserRoundIcon} title={copy.identity.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-name">{copy.identity.name}</Label>
              <Input
                id="agent-name"
                value={draft.name}
                placeholder={copy.identity.namePlaceholder}
                maxLength={80}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-role">{copy.identity.role}</Label>
              <Input
                id="agent-role"
                value={draft.role}
                placeholder={copy.identity.rolePlaceholder}
                maxLength={120}
                onChange={(e) => update("role", e.target.value)}
              />
            </div>
          </div>
        </Section>

        <Section icon={BrainCircuitIcon} title={copy.model.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-provider">{copy.model.provider}</Label>
              <NativeSelect
                id="agent-provider"
                value={draft.provider}
                onChange={(e) => {
                  const next = MODEL_PROVIDERS.find((p) => p.id === e.target.value);
                  setDraft((d) => ({
                    ...d,
                    provider: e.target.value,
                    model: next?.models[0]?.id ?? "",
                  }));
                }}
              >
                {MODEL_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.configured ? "" : ` — ${copy.model.notConfigured}`}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-model">{copy.model.model}</Label>
              <NativeSelect
                id="agent-model"
                value={draft.model}
                onChange={(e) => update("model", e.target.value)}
              >
                {(provider?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {!providerReady ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleAlertIcon aria-hidden className="size-4 text-warning" />
              {copy.model.setupNotice}
            </p>
          ) : null}
        </Section>

        <Section icon={FileTextIcon} title={copy.instructions.title}>
          <div className="space-y-2">
            <Label htmlFor="agent-instructions">{copy.instructions.label}</Label>
            <Textarea
              id="agent-instructions"
              rows={7}
              value={draft.instructions}
              placeholder={copy.instructions.placeholder}
              maxLength={20_000}
              aria-describedby="agent-instructions-help"
              onChange={(e) => update("instructions", e.target.value)}
            />
            <div
              id="agent-instructions-help"
              className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
            >
              <span>{copy.instructions.help}</span>
              <span className="tabular-nums">
                {interpolate(copy.instructions.count, { n: draft.instructions.length })}
              </span>
            </div>
          </div>
        </Section>

        <Section icon={WrenchIcon} title={copy.tools.title}>
          <ul className="space-y-2">
            {TOOL_CATALOG.map((tool) => {
              const id = `tool-${tool.key}`;
              const checked = draft.tools.some((x) => x.toolKey === tool.key);
              return (
                <li
                  key={tool.key}
                  className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={() => toggleTool(tool.key, tool.risk)}
                    />
                    <Label htmlFor={id} className="font-normal">
                      {copy.tools.names[tool.key as keyof typeof copy.tools.names] ?? tool.key}
                    </Label>
                  </div>
                  {tool.risk === "read_only" ? (
                    <Badge variant="secondary">
                      <ShieldCheckIcon aria-hidden />
                      {copy.tools.readOnly}
                    </Badge>
                  ) : (
                    <Badge variant="demo">
                      <ShieldAlertIcon aria-hidden />
                      {copy.tools.requiresApproval}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {interpolate(copy.tools.plannedNote, { phase: "P4" })}
          </p>
        </Section>

        <Section icon={GaugeIcon} title={copy.limits.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-max-steps">{copy.limits.maxSteps}</Label>
              <Input
                id="agent-max-steps"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={Number.isNaN(draft.maxSteps) ? "" : draft.maxSteps}
                onChange={(e) => update("maxSteps", e.target.valueAsNumber)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-max-spend">{copy.limits.maxSpend}</Label>
              <Input
                id="agent-max-spend"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={Number.isNaN(draft.maxSpendUsd) ? "" : draft.maxSpendUsd}
                onChange={(e) => update("maxSpendUsd", e.target.valueAsNumber)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{copy.limits.help}</p>
        </Section>
      </form>

      <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{copy.validation.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div aria-live="polite" data-testid="studio-validation">
              {validation.ok ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CircleCheckIcon aria-hidden className="size-4" />
                  {copy.validation.valid}
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{copy.validation.invalid}</p>
                  <ul className="list-inside list-disc space-y-1">
                    {validation.fields.map((f) => (
                      <li key={f}>{copy.validation.fields[f]}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled>
                <SaveIcon aria-hidden />
                {copy.actions.saveDraft}
              </Button>
              <Button type="button" disabled>
                <SendIcon aria-hidden />
                {copy.actions.publish}
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {copy.actions.disabledReason}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              {copy.test.title}
              <Badge variant="demo">{copy.preview}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="studio-test-input" className="sr-only">
              {copy.test.inputLabel}
            </Label>
            <Textarea
              id="studio-test-input"
              rows={3}
              value={testInput}
              placeholder={copy.test.inputPlaceholder}
              onChange={(e) => setTestInput(e.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{copy.test.estimate}</span>
              <span className="tabular-nums">—</span>
            </div>
            <Button
              type="button"
              className="w-full"
              // P0: always disabled — there is no runtime, regardless of provider config.
              disabled
              aria-describedby="studio-run-reason"
              data-testid="studio-run"
            >
              <PlayIcon aria-hidden />
              {copy.test.run}
            </Button>
            <p id="studio-run-reason" className="text-xs text-muted-foreground">
              {copy.test.disabledReason}
            </p>
            <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              {copy.test.outputEmpty}
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
