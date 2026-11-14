"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { AdminTemplate } from "@/modules/platform-admin/templates";
import type { Dictionary } from "@/i18n";

/**
 * Catalog management.
 *
 * A JSON textarea rather than a built form, deliberately. The definition is an
 * agent configuration whose shape changes with every phase, and a bespoke form
 * would need updating in lockstep or it would quietly stop being able to
 * express the current schema. The server validates against
 * `AgentConfigSchema`, so a malformed definition is refused with the fields
 * named rather than stored.
 *
 * This is an internal tool for a handful of operators. Spending the design
 * budget here instead of on customer screens would be the wrong trade.
 */
export function TemplateManager({
  t,
  templates,
}: {
  t: Dictionary;
  templates: readonly AdminTemplate[];
}) {
  const router = useRouter();
  const s = t.admin.sections.templates;
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(key: string, run: () => Promise<{ ok: boolean; message?: string | null }>) {
    setError(null);
    setNotice(null);
    setBusy(key);
    const res = await run();
    setBusy(null);
    if (!res.ok) {
      setError(res.message ?? t.auth.errors.generic);
      return;
    }
    setNotice(s.saved);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      <FormAlert tone="info">{s.copyNote}</FormAlert>

      <CreateTemplateForm t={t} busy={busy} onAct={act} />

      {templates.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground shadow-sm">
          {s.empty}
        </p>
      ) : (
        templates.map((template) => (
          <section key={template.id} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{template.name}</h3>
                <p dir="ltr" className="font-mono text-xs text-muted-foreground">
                  {template.slug} · {template.category}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{s.visibilityLabel}</span>
                <NativeSelect
                  className="h-9 w-36"
                  value={template.visibility}
                  disabled={busy !== null}
                  onChange={(e) =>
                    void act(`vis-${template.id}`, () =>
                      sendJson(`/api/admin/templates/${template.id}`, "PATCH", {
                        op: "visibility",
                        visibility: e.target.value,
                      }),
                    )
                  }
                >
                  {(["draft", "public", "retired"] as const).map((v) => (
                    <option key={v} value={v}>
                      {s.visibilities[v]}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>

            <p className="text-sm text-muted-foreground">{template.description}</p>

            <div>
              <h4 className="mb-2 text-sm font-medium">{s.versionsHeading}</h4>
              {template.versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">—</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {template.versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span dir="ltr" className="font-mono text-xs">
                        v{v.version} · {v.publishedAt?.slice(0, 10) ?? "—"}
                      </span>
                      {v.isActive ? (
                        <Badge variant="secondary">{s.activeBadge}</Badge>
                      ) : v.publishedAt ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            void act(`rb-${v.id}`, () =>
                              sendJson(`/api/admin/templates/${template.id}`, "PATCH", {
                                op: "rollback",
                                versionId: v.id,
                              }),
                            )
                          }
                        >
                          {s.rollback}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <PublishVersionForm t={t} templateId={template.id} busy={busy} onAct={act} />
          </section>
        ))
      )}
    </div>
  );
}

type ActFn = (
  key: string,
  run: () => Promise<{ ok: boolean; message?: string | null }>,
) => Promise<void>;

function CreateTemplateForm({
  t,
  busy,
  onAct,
}: {
  t: Dictionary;
  busy: string | null;
  onAct: ActFn;
}) {
  const s = t.admin.sections.templates;
  const [slug, setSlug] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  return (
    <form
      className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void onAct("create", async () => {
          const res = await sendJson("/api/admin/templates", "POST", {
            slug,
            category,
            name,
            description,
          });
          if (res.ok) {
            setSlug("");
            setCategory("");
            setName("");
            setDescription("");
          }
          return res;
        });
      }}
      noValidate
    >
      <h3 className="text-base font-semibold">{s.createHeading}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="tplSlug"
          label={s.slugLabel}
          dir="ltr"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
        />
        <TextField
          id="tplCategory"
          label={s.categoryLabel}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        />
        <TextField
          id="tplName"
          label={s.nameLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <TextField
          id="tplDescription"
          label={s.descriptionLabel}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={busy !== null}>
        {busy === "create" ? <Spinner label={s.creating} /> : s.create}
      </Button>
    </form>
  );
}

function PublishVersionForm({
  t,
  templateId,
  busy,
  onAct,
}: {
  t: Dictionary;
  templateId: string;
  busy: string | null;
  onAct: ActFn;
}) {
  const s = t.admin.sections.templates;
  const [json, setJson] = React.useState("");
  const [tools, setTools] = React.useState("");
  const [parseError, setParseError] = React.useState<string | null>(null);

  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setParseError(null);

        let definition: unknown;
        try {
          definition = JSON.parse(json);
        } catch {
          // Caught here rather than sent: a malformed body would come back as
          // a generic validation error, which says nothing about where the
          // bracket is missing.
          setParseError(s.invalidJson);
          return;
        }

        void onAct(`pub-${templateId}`, async () => {
          const res = await sendJson(`/api/admin/templates/${templateId}/versions`, "POST", {
            definition,
            requiredTools: tools
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          });
          if (res.ok) {
            setJson("");
            setTools("");
          }
          return res;
        });
      }}
      noValidate
    >
      <h4 className="text-sm font-medium">{s.publishHeading}</h4>
      {parseError ? <FormAlert tone="error">{parseError}</FormAlert> : null}
      <Field id={`def-${templateId}`} label={s.definitionLabel} hint={s.definitionHint}>
        <Textarea
          id={`def-${templateId}`}
          dir="ltr"
          className="min-h-40 font-mono text-xs"
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </Field>
      <TextField
        id={`tools-${templateId}`}
        label={s.requiredToolsLabel}
        dir="ltr"
        value={tools}
        onChange={(e) => setTools(e.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={busy !== null || json.trim() === ""}>
        {busy === `pub-${templateId}` ? <Spinner label={s.publishing} /> : s.publish}
      </Button>
    </form>
  );
}
