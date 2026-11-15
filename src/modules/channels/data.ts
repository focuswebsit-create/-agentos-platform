import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";

/** Customer-side reads for channels, as the signed-in user under RLS (0024). */

export type Widget = {
  id: string;
  agentId: string;
  agentName: string;
  publicKey: string;
  enabled: boolean;
  allowedOrigins: string[];
  greeting: string | null;
  dailyMessageLimit: number;
  conversationMessageLimit: number;
};
export type ConversationSummary = {
  id: string;
  status: "open" | "handoff" | "closed";
  lastMessageAt: string;
  widgetId: string;
};
export type ConversationDetail = ConversationSummary & {
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
};

const MISSING = ["PGRST205", "42P01"];

export async function listChannels(
  orgId: string,
): Promise<
  | { ok: true; widgets: Widget[]; conversations: ConversationSummary[] }
  | { ok: false; reason: "not_provisioned" | "error" }
> {
  const supabase = await createSupabaseServerClient();
  const { data: w, error } = await supabase
    .from("chat_widgets")
    .select(
      "id, agent_id, public_key, enabled, allowed_origins, greeting, daily_message_limit, conversation_message_limit, agents(name)",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) {
    return {
      ok: false,
      reason: MISSING.includes(String(error.code)) ? "not_provisioned" : "error",
    };
  }
  const { data: c } = await supabase
    .from("conversations")
    .select("id, status, last_message_at, widget_id")
    .eq("org_id", orgId)
    .order("last_message_at", { ascending: false })
    .limit(50);

  return {
    ok: true,
    widgets: ((w ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      agentId: String(r.agent_id),
      agentName: ((r.agents as { name?: string } | null)?.name ?? "") as string,
      publicKey: String(r.public_key),
      enabled: r.enabled === true,
      allowedOrigins: (r.allowed_origins as string[]) ?? [],
      greeting: (r.greeting as string | null) ?? null,
      dailyMessageLimit: Number(r.daily_message_limit),
      conversationMessageLimit: Number(r.conversation_message_limit),
    })),
    conversations: ((c ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      status: r.status as ConversationSummary["status"],
      lastMessageAt: String(r.last_message_at),
      widgetId: String(r.widget_id),
    })),
  };
}

export async function getConversation(
  orgId: string,
  id: string,
): Promise<ConversationDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data: c } = await supabase
    .from("conversations")
    .select("id, status, last_message_at, widget_id")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;
  const row = c as Record<string, unknown>;
  const { data: msgs } = await supabase
    .from("conversation_messages")
    .select("id, role, content, created_at")
    .eq("org_id", orgId)
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  return {
    id: String(row.id),
    status: row.status as ConversationSummary["status"],
    lastMessageAt: String(row.last_message_at),
    widgetId: String(row.widget_id),
    messages: ((msgs ?? []) as Array<Record<string, unknown>>).map((m) => ({
      id: String(m.id),
      role: String(m.role),
      content: String(m.content),
      createdAt: String(m.created_at),
    })),
  };
}
