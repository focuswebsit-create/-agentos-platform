"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert, Spinner } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { ConversationDetail } from "@/modules/channels/data";
import type { Dictionary } from "@/i18n";

export function ConversationView({
  t,
  orgId,
  conversation,
  canAct,
}: {
  t: Dictionary;
  orgId: string;
  conversation: ConversationDetail;
  canAct: boolean;
}) {
  const c = t.channels;
  const router = useRouter();
  const [reply, setReply] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);

  async function setStatus(status: "open" | "handoff" | "closed") {
    setError(null);
    setPending(status);
    const res = await sendJson(`/api/conversations/${conversation.id}/status`, "POST", {
      orgId,
      status,
    });
    setPending(null);
    if (!res.ok) setError(res.message ?? t.auth.errors.generic);
    router.refresh();
  }

  async function send() {
    setError(null);
    setPending("reply");
    const res = await sendJson(`/api/conversations/${conversation.id}/reply`, "POST", {
      orgId,
      content: reply,
    });
    setPending(null);
    if (!res.ok) {
      setError(res.message ?? t.auth.errors.generic);
      return;
    }
    setReply("");
    router.refresh();
  }

  const who = (role: string) =>
    role === "visitor"
      ? c.roles.visitor
      : role === "human"
        ? c.roles.human
        : role === "agent"
          ? c.roles.agent
          : c.roles.system;

  return (
    <div className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <ul className="space-y-2 rounded-2xl border bg-card p-4 shadow-sm">
        {conversation.messages.map((m) => (
          <li key={m.id} className={m.role === "visitor" ? "text-start" : "text-end"}>
            <span className="block text-xs text-muted-foreground">{who(m.role)}</span>
            <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm">
              {m.content}
            </span>
          </li>
        ))}
      </ul>
      {canAct ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {conversation.status !== "handoff" ? (
              <Button
                type="button"
                onClick={() => void setStatus("handoff")}
                disabled={pending !== null}
              >
                {pending === "handoff" ? <Spinner label={c.takingOver} /> : c.takeOver}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => void setStatus("open")}
                disabled={pending !== null}
              >
                {c.giveBack}
              </Button>
            )}
            {conversation.status !== "closed" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void setStatus("closed")}
                disabled={pending !== null}
              >
                {c.close}
              </Button>
            ) : null}
          </div>
          {conversation.status === "handoff" ? (
            <div className="space-y-2">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={4000}
                aria-label={c.replyLabel}
              />
              <Button
                type="button"
                onClick={() => void send()}
                disabled={pending !== null || !reply.trim()}
              >
                {pending === "reply" ? <Spinner label={c.sending} /> : c.send}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{c.takeOverHint}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
