import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/modules/service-role/client";
import { sanitizeText } from "@/modules/knowledge/text";
import { executeRun } from "./executor";

/**
 * The public Web Chat channel, on the execution plane.
 *
 * Every operation here runs with the service role on behalf of an anonymous
 * visitor, so every one of them is scoped explicitly: by the widget's public
 * key (which resolves to exactly one organisation) and by the visitor token's
 * hash (which resolves to exactly one conversation of that widget). The
 * database functions in 0024 enforce enablement, rate limits and every run
 * limit under the organisation lock; this module never decides those itself.
 */

export const MAX_VISITOR_MESSAGE_CHARS = 2000;
const TRANSCRIPT_MESSAGES = 10;

export type WidgetInfo = {
  enabled: boolean;
  greeting: string | null;
  allowedOrigins: string[];
  agentName: string;
};

export type ChatMessage = { role: "visitor" | "agent" | "human"; content: string; at: string };

export type ChatError =
  | "NOT_CONFIGURED"
  | "WIDGET_NOT_AVAILABLE"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_CLOSED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

const sha = (s: string) => createHash("sha256").update(s).digest();
const hex = (b: Buffer) => `\\x${b.toString("hex")}`;

/** A salted hash of the client address; the address itself is never stored. */
export function hashIp(ip: string | null): Buffer | null {
  return ip ? sha(`agentos-chat-ip:${ip}`) : null;
}

function classify(message: string | undefined): ChatError {
  const m = message ?? "";
  for (const code of [
    "WIDGET_NOT_AVAILABLE",
    "CONVERSATION_NOT_FOUND",
    "CONVERSATION_CLOSED",
    "RATE_LIMITED",
  ] as const) {
    if (m.includes(code)) return code;
  }
  return "UNAVAILABLE";
}

function db() {
  return isServiceRoleConfigured() ? createServiceRoleClient() : null;
}

export async function getWidgetInfo(publicKey: string): Promise<WidgetInfo | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("chat_widgets")
    .select("enabled, greeting, allowed_origins, org_id, agent_id")
    .eq("public_key", publicKey)
    .maybeSingle();
  const w = data as {
    enabled: boolean;
    greeting: string | null;
    allowed_origins: string[];
    org_id: string;
    agent_id: string;
  } | null;
  if (!w) return null;
  const { data: agent } = await client
    .from("agents")
    .select("name")
    .eq("org_id", w.org_id)
    .eq("id", w.agent_id)
    .maybeSingle();
  return {
    enabled: w.enabled,
    greeting: w.greeting,
    allowedOrigins: w.allowed_origins ?? [],
    agentName: (agent as { name: string } | null)?.name ?? "",
  };
}

export async function openConversation(
  publicKey: string,
  ip: string | null,
): Promise<{ ok: true; token: string } | { ok: false; error: ChatError }> {
  const client = db();
  if (!client) return { ok: false, error: "NOT_CONFIGURED" };
  const token = randomBytes(32).toString("base64url");
  const ipHash = hashIp(ip);
  const { error } = await client.rpc("open_conversation", {
    p_public_key: publicKey,
    p_token_hash: hex(sha(token)),
    p_ip_hash: ipHash ? hex(ipHash) : null,
  });
  if (error) return { ok: false, error: classify(error.message) };
  return { ok: true, token };
}

async function conversationFor(
  client: NonNullable<ReturnType<typeof db>>,
  publicKey: string,
  token: string,
) {
  const { data: w } = await client
    .from("chat_widgets")
    .select("id, org_id")
    .eq("public_key", publicKey)
    .maybeSingle();
  if (!w) return null;
  const widget = w as { id: string; org_id: string };
  const { data: c } = await client
    .from("conversations")
    .select("id, status")
    .eq("org_id", widget.org_id)
    .eq("widget_id", widget.id)
    .eq("visitor_token_hash", hex(sha(token)))
    .maybeSingle();
  return c ? { ...(c as { id: string; status: string }), orgId: widget.org_id } : null;
}

export async function listMessages(
  publicKey: string,
  token: string,
): Promise<
  { ok: true; status: string; messages: ChatMessage[] } | { ok: false; error: ChatError }
> {
  const client = db();
  if (!client) return { ok: false, error: "NOT_CONFIGURED" };
  const conv = await conversationFor(client, publicKey, token);
  if (!conv) return { ok: false, error: "CONVERSATION_NOT_FOUND" };
  const { data } = await client
    .from("conversation_messages")
    .select("role, content, created_at")
    .eq("org_id", conv.orgId)
    .eq("conversation_id", conv.id)
    .in("role", ["visitor", "agent", "human"])
    .order("created_at", { ascending: true })
    .limit(200);
  return {
    ok: true,
    status: conv.status,
    messages: (
      (data ?? []) as Array<{ role: ChatMessage["role"]; content: string; created_at: string }>
    ).map((m) => ({ role: m.role, content: m.content, at: m.created_at })),
  };
}

/**
 * The prompt a channel run receives: the recent conversation, then the new
 * message. The visitor's words are the user turn - untrusted by nature, and
 * the system prompt (role, instructions, knowledge framing) is unaffected by them.
 */
export function buildChannelPrompt(history: ChatMessage[], message: string): string {
  const lines = history.slice(-TRANSCRIPT_MESSAGES).map((m) => {
    const who = m.role === "visitor" ? "Customer" : m.role === "human" ? "Staff" : "You";
    return `${who}: ${m.content}`;
  });
  return lines.length > 0
    ? `Conversation so far:\n${lines.join("\n")}\n\nCustomer's new message:\n${message}`
    : message;
}

export async function postVisitorMessage(
  publicKey: string,
  token: string,
  raw: string,
): Promise<{ ok: true; reply: string | null; handoff: boolean } | { ok: false; error: ChatError }> {
  const client = db();
  if (!client) return { ok: false, error: "NOT_CONFIGURED" };
  const content = sanitizeText(raw).slice(0, MAX_VISITOR_MESSAGE_CHARS);
  if (!content) return { ok: false, error: "UNAVAILABLE" };

  const history = await listMessages(publicKey, token);
  if (!history.ok) return history;

  const { data, error } = await client.rpc("post_visitor_message", {
    p_public_key: publicKey,
    p_token_hash: hex(sha(token)),
    p_content: content,
    p_prompt: { prompt: buildChannelPrompt(history.messages, content) },
  });
  if (error) return { ok: false, error: classify(error.message) };

  const dispatch = data as {
    run_id: string | null;
    handoff: boolean;
    conversation_id?: string;
    org_id?: string;
  };
  if (dispatch.handoff || !dispatch.run_id || !dispatch.org_id || !dispatch.conversation_id) {
    return { ok: true, reply: null, handoff: true };
  }

  // Executed inside this request: the visitor is waiting for the answer, and
  // a request that stays open does not depend on background work surviving.
  await executeRun(dispatch.run_id, { expectedOrgId: dispatch.org_id });

  const { data: run } = await client
    .from("runs")
    .select("status, result_json")
    .eq("org_id", dispatch.org_id)
    .eq("id", dispatch.run_id)
    .maybeSingle();
  const r = run as { status: string; result_json: { output?: unknown } | null } | null;
  const output = typeof r?.result_json?.output === "string" ? r.result_json.output : null;
  if (r?.status !== "succeeded" || !output) return { ok: false, error: "UNAVAILABLE" };

  const reply = output.slice(0, 4000);
  await client.from("conversation_messages").insert({
    org_id: dispatch.org_id,
    conversation_id: dispatch.conversation_id,
    role: "agent",
    content: reply,
    run_id: dispatch.run_id,
  });
  return { ok: true, reply, handoff: false };
}
