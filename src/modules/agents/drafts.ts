import "server-only";
import type { createSupabaseServerClient } from "@/modules/supabase/server";
import { AgentDraftConfigSchema, type AgentDraftConfig } from "@/modules/contracts";

/**
 * Draft operations shared by save, restore and duplicate.
 *
 * All of them run as the signed-in user, under RLS. The draft is the agent's
 * one unpublished version; 0007's policy and 0008's trigger both refuse a
 * write to a published one, and the `published_at is null` filter here says
 * the same thing a third time.
 */

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type DraftWrite =
  | { ok: true; versionId: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "db"; error: { message?: string; code?: string } };

export async function writeDraft(
  supabase: Client,
  orgId: string,
  agentId: string,
  config: AgentDraftConfig,
): Promise<DraftWrite> {
  const { data, error } = await supabase
    .from("agent_versions")
    .update({ config_json: config })
    .eq("agent_id", agentId)
    .eq("org_id", orgId)
    .is("published_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: "db", error };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, versionId: (data as { id: string }).id };
}

/**
 * The configuration of one PUBLISHED version of `agentId`, read leniently so
 * that a version published under an older schema can still be restored.
 * Null when the version does not exist, belongs to another agent or
 * organisation (RLS returns no row), or is not published.
 */
export async function readPublishedConfig(
  supabase: Client,
  orgId: string,
  agentId: string,
  versionId: string,
): Promise<AgentDraftConfig | null> {
  const { data } = await supabase
    .from("agent_versions")
    .select("config_json, published_at")
    .eq("org_id", orgId)
    .eq("agent_id", agentId)
    .eq("id", versionId)
    .maybeSingle();
  const row = data as { config_json: unknown; published_at: string | null } | null;
  if (!row || row.published_at === null) return null;
  const parsed = AgentDraftConfigSchema.safeParse(row.config_json ?? {});
  return parsed.success ? parsed.data : null;
}
