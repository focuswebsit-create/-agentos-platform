import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";

/**
 * Reads for the runs screens.
 *
 * Uses the ordinary user client, not the service role: a customer reading
 * their own runs is exactly what the policies in 0014 are for, and reaching
 * for the privileged client here would bypass the check this product depends
 * on. The explicit org filter is the second of the two checks DATA_MODEL.md
 * requires.
 */

export type RunStatus =
  "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled";

export type RunSummary = {
  id: string;
  agentId: string;
  agentName: string;
  status: RunStatus;
  errorCode: string | null;
  createdAt: string;
  endedAt: string | null;
};

export type RunStep = {
  id: string;
  stepIndex: number;
  kind: string;
  status: string;
  provider: string | null;
  model: string | null;
  /** Owner and admin only; null for everyone else, because 0014 hides it. */
  usageUsdMicros: number | null;
  errorCode: string | null;
  summary: Record<string, unknown>;
  endedAt: string | null;
};

export type RunDetail = RunSummary & {
  /** The model's answer, or null while it is still running or if it failed. */
  output: string | null;
  steps: RunStep[];
};

type RunRow = {
  id: string;
  agent_id: string;
  status: RunStatus;
  error_code: string | null;
  created_at: string;
  ended_at: string | null;
  agents: { name: string } | null;
};

export async function listRuns(orgId: string, limit = 50): Promise<RunSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("runs")
    .select("id, agent_id, status, error_code, created_at, ended_at, agents!inner(name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as unknown as RunRow[]).map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agents?.name ?? "—",
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  }));
}

export async function getRun(orgId: string, runId: string): Promise<RunDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: runData, error } = await supabase
    .from("runs")
    .select(
      "id, agent_id, status, error_code, created_at, ended_at, result_json, agents!inner(name)",
    )
    .eq("org_id", orgId)
    .eq("id", runId)
    .maybeSingle();

  if (error || !runData) return null;
  const row = runData as unknown as RunRow & { result_json: { output?: unknown } | null };

  const { data: stepData } = await supabase
    .from("run_steps")
    .select(
      "id, step_index, kind, status, provider, model, usage_usd_micros, error_code, summary_json, ended_at",
    )
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .order("step_index", { ascending: true });

  const steps = (stepData ?? []) as unknown as Array<{
    id: string;
    step_index: number;
    kind: string;
    status: string;
    provider: string | null;
    model: string | null;
    usage_usd_micros: string | number | null;
    error_code: string | null;
    summary_json: Record<string, unknown> | null;
    ended_at: string | null;
  }>;

  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agents?.name ?? "—",
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    output: typeof row.result_json?.output === "string" ? row.result_json.output : null,
    steps: steps.map((s) => ({
      id: s.id,
      stepIndex: s.step_index,
      kind: s.kind,
      status: s.status,
      provider: s.provider,
      model: s.model,
      usageUsdMicros: s.usage_usd_micros === null ? null : Number(s.usage_usd_micros),
      errorCode: s.error_code,
      summary: s.summary_json ?? {},
      endedAt: s.ended_at,
    })),
  };
}

/**
 * Monthly spend against the cap. Raises for anyone who is not an owner or
 * admin, so this returns null rather than letting the page crash on a role
 * that simply may not see it.
 */
export async function getUsageSummary(orgId: string): Promise<{
  periodStart: string;
  capUsdMicros: number;
  spentUsdMicros: number;
  reservedUsdMicros: number;
} | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("org_usage_summary", { p_org_id: orgId });
  if (error || !data) return null;
  return data as {
    periodStart: string;
    capUsdMicros: number;
    spentUsdMicros: number;
    reservedUsdMicros: number;
  };
}
