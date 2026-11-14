import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import {
  AgentDraftConfigSchema,
  type AgentDraftConfig,
  type AgentStatus,
} from "@/modules/contracts";

/**
 * Reads for Agent Studio.
 *
 * Every query carries an explicit org filter even though RLS already scopes it.
 * That redundancy is the point: DATA_MODEL.md requires an API-level tenant check
 * AND row level security, so a policy regression alone cannot leak another
 * tenant's rows. tests/db/rls-suite.mjs proves the database half independently.
 */

export type AgentSummary = {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  activeVersionId: string | null;
  /** Highest published version number, or null if it has never been published. */
  publishedVersion: number | null;
  updatedAt: string;
};

export type AgentDetail = AgentSummary & {
  draftVersionId: string;
  draftConfig: AgentDraftConfig;
  history: Array<{ id: string; version: number; publishedAt: string }>;
};

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  active_version_id: string | null;
  updated_at: string;
};

type VersionRow = {
  id: string;
  version: number | null;
  published_at: string | null;
  config_json: unknown;
};

/**
 * A stored draft is parsed, not cast. It was written by an earlier version of
 * this application and the schema may since have changed; `safeParse` with the
 * schema's own defaults turns a stale or partial row into something the editor
 * can open, instead of a runtime error on a page the user cannot get past.
 */
function readDraft(raw: unknown): AgentDraftConfig {
  const parsed = AgentDraftConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AgentDraftConfigSchema.parse({});
}

export async function listAgents(orgId: string): Promise<AgentSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, description, status, active_version_id, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];
  const rows = data as unknown as AgentRow[];
  if (rows.length === 0) return [];

  // One query for every agent's published versions rather than one per agent.
  const { data: versions } = await supabase
    .from("agent_versions")
    .select("agent_id, version")
    .eq("org_id", orgId)
    .not("version", "is", null);

  const highest = new Map<string, number>();
  for (const v of (versions ?? []) as unknown as Array<{ agent_id: string; version: number }>) {
    const current = highest.get(v.agent_id);
    if (current === undefined || v.version > current) highest.set(v.agent_id, v.version);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    activeVersionId: row.active_version_id,
    publishedVersion: highest.get(row.id) ?? null,
    updatedAt: row.updated_at,
  }));
}

export async function getAgent(orgId: string, agentId: string): Promise<AgentDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: agentData, error } = await supabase
    .from("agents")
    .select("id, name, description, status, active_version_id, updated_at")
    .eq("org_id", orgId)
    .eq("id", agentId)
    .maybeSingle();

  if (error || !agentData) return null;
  const agent = agentData as unknown as AgentRow;

  const { data: versionData } = await supabase
    .from("agent_versions")
    .select("id, version, published_at, config_json")
    .eq("org_id", orgId)
    .eq("agent_id", agentId)
    .order("version", { ascending: false, nullsFirst: true });

  const versions = (versionData ?? []) as unknown as VersionRow[];
  const draft = versions.find((v) => v.published_at === null);

  // Every agent has exactly one draft — 0006 enforces it with a partial unique
  // index and the RPCs maintain it. If one is missing the row is corrupt, and
  // showing an editor backed by nothing would invite a save that goes nowhere.
  if (!draft) return null;

  const published = versions.filter(
    (v): v is VersionRow & { version: number; published_at: string } =>
      v.published_at !== null && v.version !== null,
  );

  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    activeVersionId: agent.active_version_id,
    publishedVersion: published[0]?.version ?? null,
    updatedAt: agent.updated_at,
    draftVersionId: draft.id,
    draftConfig: readDraft(draft.config_json),
    history: published.map((v) => ({
      id: v.id,
      version: v.version,
      publishedAt: v.published_at,
    })),
  };
}
