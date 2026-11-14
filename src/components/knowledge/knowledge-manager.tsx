"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { KnowledgeBase } from "@/modules/knowledge/data";
import type { Dictionary } from "@/i18n";

const MAX_BYTES = 512 * 1024;

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * Knowledge sources: create a base, add text or markdown by pasting or
 * uploading, delete. Files are read in the browser as TEXT and sent as a JSON
 * string - never stored as files, never rendered as HTML. The server repeats
 * every check made here.
 */
export function KnowledgeManager({
  t,
  orgId,
  bases,
  canWrite,
  canDelete,
}: {
  t: Dictionary;
  orgId: string;
  bases: KnowledgeBase[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const k = t.knowledge;
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  async function createBase(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending("create");
    const res = await sendJson(`/api/knowledge`, "POST", { orgId, name });
    setPending(null);
    if (!res.ok) {
      setError(res.message ?? t.auth.errors.generic);
      return;
    }
    setName("");
    router.refresh();
  }

  async function removeDocument(id: string) {
    setError(null);
    setPending(`delete-${id}`);
    const res = await sendJson(`/api/knowledge/documents/${id}`, "DELETE", { orgId });
    setPending(null);
    if (!res.ok) setError(res.message ?? t.auth.errors.generic);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      {canWrite ? (
        <form
          onSubmit={createBase}
          className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div className="min-w-56 flex-1">
            <TextField
              id="kbName"
              label={k.newBaseLabel}
              placeholder={k.newBasePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={120}
            />
          </div>
          <Button type="submit" disabled={pending !== null || name.trim().length < 2}>
            {pending === "create" ? <Spinner label={k.creating} /> : k.createBase}
          </Button>
        </form>
      ) : null}

      {bases.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">{k.empty}</p>
      ) : (
        bases.map((base) => (
          <section key={base.id} className="rounded-2xl border bg-card shadow-sm" data-testid="kb">
            <header className="border-b px-5 py-4">
              <h2 className="text-base font-semibold">{base.name}</h2>
              <p className="text-xs text-muted-foreground">
                {k.documentCount.replace("{n}", String(base.documents.length))}
              </p>
            </header>
            {base.documents.length > 0 ? (
              <ul className="divide-y">
                {base.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{doc.title}</span>
                      <span dir="ltr" className="block text-xs text-muted-foreground">
                        {kb(doc.byteSize)} · {doc.chunkCount} chunks
                      </span>
                    </span>
                    {canDelete ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void removeDocument(doc.id)}
                        disabled={pending !== null}
                      >
                        {pending === `delete-${doc.id}` ? <Spinner label={k.deleting} /> : k.delete}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canWrite ? (
              <AddDocument
                t={t}
                orgId={orgId}
                baseId={base.id}
                onDone={(message) => {
                  setNotice(message);
                  router.refresh();
                }}
                onError={setError}
              />
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}

function AddDocument({
  t,
  orgId,
  baseId,
  onDone,
  onError,
}: {
  t: Dictionary;
  orgId: string;
  baseId: string;
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const k = t.knowledge;
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [mime, setMime] = React.useState<"text/plain" | "text/markdown">("text/plain");
  const [source, setSource] = React.useState<"paste" | "upload">("paste");
  const [pending, setPending] = React.useState(false);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    onError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".md")) {
      onError(k.wrongType);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      onError(k.tooLarge);
      event.target.value = "";
      return;
    }
    setContent(await file.text());
    setMime(lower.endsWith(".md") ? "text/markdown" : "text/plain");
    setSource("upload");
    if (!title) setTitle(file.name.replace(/\.(txt|md)$/i, ""));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    onError(null);
    if (new TextEncoder().encode(content).length > MAX_BYTES) {
      onError(k.tooLarge);
      return;
    }
    setPending(true);
    const res = await sendJson<{ chunks: number }>(`/api/knowledge/${baseId}/documents`, "POST", {
      orgId,
      title,
      content,
      mimeType: mime,
      sourceType: source,
    });
    setPending(false);
    if (!res.ok) {
      onError(res.message ?? t.auth.errors.generic);
      return;
    }
    setTitle("");
    setContent("");
    setSource("paste");
    onDone(k.added.replace("{n}", String(res.data.chunks)));
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t px-5 py-4">
      <h3 className="text-sm font-semibold">{k.addDocument}</h3>
      <TextField
        id={`docTitle-${baseId}`}
        label={k.titleLabel}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
      />
      <Field id={`docContent-${baseId}`} label={k.contentLabel} hint={k.contentHint}>
        <Textarea
          id={`docContent-${baseId}`}
          className="min-h-32"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setSource("paste");
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="me-2 text-muted-foreground">{k.uploadLabel}</span>
          <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} />
        </label>
        <Button
          type="submit"
          disabled={pending || title.trim().length === 0 || content.trim().length === 0}
        >
          {pending ? <Spinner label={k.adding} /> : k.add}
        </Button>
      </div>
    </form>
  );
}
