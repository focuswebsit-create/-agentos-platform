"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { ConversationSummary, Widget } from "@/modules/channels/data";
import type { Dictionary } from "@/i18n";

export function ChannelsManager({
  t,
  orgId,
  siteUrl,
  widgets,
  conversations,
  agents,
  canManage,
}: {
  t: Dictionary;
  orgId: string;
  siteUrl: string;
  widgets: Widget[];
  conversations: ConversationSummary[];
  agents: Array<{ id: string; name: string; published: boolean }>;
  canManage: boolean;
}) {
  const c = t.channels;
  const router = useRouter();
  const [agentId, setAgentId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; message?: string | null }>) {
    setError(null);
    setPending(key);
    const res = await fn();
    setPending(null);
    if (!res.ok) setError(res.message ?? t.auth.errors.generic);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-1 text-base font-semibold">{c.webChatHeading}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{c.webChatBody}</p>

        {canManage ? (
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Field id="widgetAgent" label={c.agentLabel}>
              <NativeSelect
                id="widgetAgent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">{c.agentPlaceholder}</option>
                {agents
                  .filter((a) => a.published)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Button
              type="button"
              disabled={!agentId || pending !== null}
              onClick={() =>
                void run("create", () => sendJson("/api/widgets", "POST", { orgId, agentId }))
              }
            >
              {pending === "create" ? <Spinner label={c.creating} /> : c.create}
            </Button>
          </div>
        ) : null}

        {widgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noWidgets}</p>
        ) : (
          <ul className="space-y-4">
            {widgets.map((w) => (
              <WidgetCard
                key={w.id}
                t={t}
                orgId={orgId}
                siteUrl={siteUrl}
                widget={w}
                canManage={canManage}
                busy={pending !== null}
                onRun={run}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card shadow-sm">
        <h2 className="border-b px-5 py-4 text-base font-semibold">{c.conversationsHeading}</h2>
        {conversations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{c.noConversations}</p>
        ) : (
          <ul className="divide-y">
            {conversations.map((conv) => (
              <li key={conv.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <Link
                  href={`/app/integrations/conversations/${conv.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {c.conversation} ·{" "}
                  <span dir="ltr">{conv.lastMessageAt.slice(0, 16).replace("T", " ")}</span>
                </Link>
                <Badge
                  variant={
                    conv.status === "handoff"
                      ? "demo"
                      : conv.status === "closed"
                        ? "muted"
                        : "secondary"
                  }
                >
                  {c.statuses[conv.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-1 text-base font-semibold">{c.whatsappHeading}</h2>
        <p className="text-sm text-muted-foreground">{c.whatsappBody}</p>
      </section>
    </div>
  );
}

function WidgetCard({
  t,
  orgId,
  siteUrl,
  widget,
  canManage,
  busy,
  onRun,
}: {
  t: Dictionary;
  orgId: string;
  siteUrl: string;
  widget: Widget;
  canManage: boolean;
  busy: boolean;
  onRun: (
    key: string,
    fn: () => Promise<{ ok: boolean; message?: string | null }>,
  ) => Promise<void>;
}) {
  const c = t.channels;
  const [origins, setOrigins] = React.useState(widget.allowedOrigins.join(", "));
  const url = `${siteUrl}/chat/${widget.publicKey}`;
  const embed = `<iframe src="${url}" title="chat" style="width:380px;height:560px;border:0;border-radius:16px"></iframe>`;

  return (
    <li className="rounded-xl border p-4" data-testid="widget">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{widget.agentName}</span>
        <Badge variant={widget.enabled ? "secondary" : "muted"}>
          {widget.enabled ? c.enabled : c.disabled}
        </Badge>
      </div>
      {canManage ? (
        <div className="space-y-3">
          <TextField
            id={`origins-${widget.id}`}
            label={c.originsLabel}
            hint={c.originsHint}
            placeholder="https://www.example.co.il"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void onRun(`origins-${widget.id}`, () =>
                  sendJson(`/api/widgets/${widget.id}`, "PATCH", {
                    orgId,
                    allowedOrigins: origins
                      .split(",")
                      .map((o) => o.trim())
                      .filter(Boolean),
                  }),
                )
              }
            >
              {c.saveOrigins}
            </Button>
            <Button
              type="button"
              variant={widget.enabled ? "outline" : "default"}
              disabled={busy}
              onClick={() =>
                void onRun(`toggle-${widget.id}`, () =>
                  sendJson(`/api/widgets/${widget.id}`, "PATCH", {
                    orgId,
                    enabled: !widget.enabled,
                  }),
                )
              }
            >
              {widget.enabled ? c.disable : c.enable}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mt-3 space-y-1 text-xs">
        <p className="text-muted-foreground">{c.embedLabel}</p>
        <pre dir="ltr" className="overflow-x-auto rounded-md bg-muted p-2">
          {embed}
        </pre>
        {widget.enabled ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {c.openChat}
          </a>
        ) : null}
        <p className="text-muted-foreground">
          {c.limits
            .replace("{day}", String(widget.dailyMessageLimit))
            .replace("{conv}", String(widget.conversationMessageLimit))}
        </p>
      </div>
    </li>
  );
}
