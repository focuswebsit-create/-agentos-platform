import "server-only";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/modules/service-role/client";
import { RuntimeAgentConfigSchema } from "@/modules/contracts";
import { getProvider } from "@/modules/agent-engine/registry";
import { priceTokens, RATE_CARD_VERSION } from "@/modules/agent-engine/rate-card";
import type { ProviderResult } from "@/modules/agent-engine/provider";
import { buildKnowledgeContext } from "@/modules/knowledge/text";
import { retrieveKnowledge } from "./knowledge";

/**
 * The execution plane.
 *
 * `ARCHITECTURE.md` keeps this separate from the control plane, and the
 * separation is literal: this module holds the only credential that can write
 * a run's status or its cost, and no customer route can reach those writes
 * except by asking this to perform a run.
 *
 * THE LIFECYCLE
 *
 *   queued --claim--> running --settle--> succeeded | failed | cancelled
 *
 * 1. **Claim, atomically.** `update runs set status='running' where id=? and
 *    status='queued'`. Exactly one caller wins. The dispatch route's `after()`,
 *    the run page's recovery kick and any future worker can all call
 *    `executeRun` for the same run, and at most one of them executes it. That
 *    is what makes triggering it more than once safe, and what prevents a
 *    duplicated model call from being billed twice.
 * 2. **Once claimed, every path settles.** Invalid config, unconfigured
 *    provider, provider failure, an exception in our own code: each records an
 *    error code and calls `settle_run`, which returns the reserved budget.
 * 3. **Before the claim, nothing is written** - because a caller that has not
 *    claimed the run does not own it. Failures there (no key, database
 *    unreachable) leave the run `queued` for another trigger, and
 *    `recoverStaleRuns()` fails it if none ever succeeds.
 *
 * Usage is recorded even when the call failed: a request that was billed and
 * then errored still costs money. Prompt and completion text never reach the
 * trace: `run_steps` stores kinds, models, counts and costs.
 *
 * NOT DURABLE YET. If the process dies mid-call the run stays `running`;
 * `recoverStaleRuns()` fails it after RUNNING_STALE_MS and the hourly
 * reservation expiry is the final backstop. Durable execution (Inngest) is
 * ADR-0011's open item.
 */

export type ExecuteOutcome =
  { ok: true; costUsdMicros: number } | { ok: false; code: string; costUsdMicros: number };

/** Upper bound on one provider call, end to end, including its single retry. */
export const PROVIDER_DEADLINE_MS = 240_000;

type RunRow = {
  id: string;
  org_id: string;
  status: string;
  agent_version_id: string;
  input_json: { prompt?: unknown } | null;
  budget_usd_micros: string | number;
  /** 0021. Absent on a database without it, which is the same as false. */
  is_test?: boolean;
  config_snapshot?: unknown;
};

type VersionRow = { config_json: unknown };

/**
 * The system prompt a run sends: the agent's role, then its instructions.
 *
 * Both come from the published version and nothing else. The organisation id,
 * the user's identity and every credential stay out of it; a prompt is the one
 * place the model is guaranteed to see, and so the one place a secret must
 * never be.
 */
export function buildSystemPrompt(role: string, instructions: string, goals = ""): string {
  const parts = [`Your role: ${role.trim()}`, instructions.trim()];
  if (goals.trim()) parts.push(`Business goals:\n${goals.trim()}`);
  return parts.join("\n\n");
}

/**
 * Codes only, never values: Vercel's function log is the one place an operator
 * can see why a run stopped, and a key or a prompt must never appear in it.
 */
function logOutcome(runId: string, code: string): void {
  console.error(`[runtime] run=${runId} outcome=${code}`);
}

export async function executeRun(
  runId: string,
  options: { expectedOrgId?: string } = {},
): Promise<ExecuteOutcome> {
  if (!isServiceRoleConfigured()) {
    logOutcome(runId, "RUNTIME_NOT_CONFIGURED");
    return { ok: false, code: "RUNTIME_NOT_CONFIGURED", costUsdMicros: 0 };
  }

  let db: ReturnType<typeof createServiceRoleClient>;
  try {
    db = createServiceRoleClient();
  } catch {
    logOutcome(runId, "RUNTIME_NOT_CONFIGURED");
    return { ok: false, code: "RUNTIME_NOT_CONFIGURED", costUsdMicros: 0 };
  }

  // ---- before the claim: read only ------------------------------------------

  const { data: runData, error: runError } = await db
    .from("runs")
    // `*` rather than a column list: is_test and config_snapshot exist only
    // once 0021 is applied, and naming them would make every run fail with a
    // read error on a database that does not have them yet.
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (runError) {
    // Typically a rejected key. Nothing can be written with it either, so the
    // run is left for recovery - and the log says which it was.
    logOutcome(runId, "RUNTIME_DB_UNAVAILABLE");
    return { ok: false, code: "RUNTIME_DB_UNAVAILABLE", costUsdMicros: 0 };
  }
  if (!runData) return { ok: false, code: "RUN_NOT_FOUND", costUsdMicros: 0 };
  const run = runData as unknown as RunRow;

  // The caller resolved an organisation and asked for one of its runs. The
  // service role would happily execute anyone's; refuse rather than trust that.
  if (options.expectedOrgId && run.org_id !== options.expectedOrgId) {
    return { ok: false, code: "RUN_NOT_FOUND", costUsdMicros: 0 };
  }

  if (run.status !== "queued") return { ok: false, code: "RUN_NOT_QUEUED", costUsdMicros: 0 };

  // ---- the claim ------------------------------------------------------------

  const { data: claimed, error: claimError } = await db
    .from("runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id");

  if (claimError) {
    logOutcome(runId, "RUNTIME_DB_UNAVAILABLE");
    return { ok: false, code: "RUNTIME_DB_UNAVAILABLE", costUsdMicros: 0 };
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Someone else claimed it between our read and our update, or it was
    // cancelled. Either way it is not ours to execute.
    return { ok: false, code: "RUN_NOT_QUEUED", costUsdMicros: 0 };
  }

  // ---- after the claim: every path settles ----------------------------------

  let cost = 0;

  const settle = async (
    status: "succeeded" | "failed" | "cancelled",
    costUsdMicros: number,
    result: unknown,
    errorCode: string | null,
  ): Promise<boolean> => {
    const args = {
      p_run_id: runId,
      p_status: status,
      p_cost_usd_micros: costUsdMicros,
      p_result: result ?? null,
      p_error_code: errorCode,
    };
    // One retry: a transient failure here would otherwise leave the run
    // `running` with its budget held until recovery notices.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await db.rpc("settle_run", args);
      if (!error) return true;
    }
    logOutcome(runId, "SETTLEMENT_FAILED");
    return false;
  };

  const fail = async (code: string): Promise<ExecuteOutcome> => {
    logOutcome(runId, code);
    const settled = await settle("failed", cost, null, code);
    return { ok: false, code: settled ? code : "SETTLEMENT_FAILED", costUsdMicros: cost };
  };

  try {
    // A test run executes the snapshot taken at dispatch - never the live
    // draft, which may have been edited since. A normal run executes its
    // pinned published version.
    let rawConfig: unknown;
    if (run.is_test === true) {
      rawConfig = run.config_snapshot;
    } else {
      const { data: versionData } = await db
        .from("agent_versions")
        .select("config_json")
        .eq("id", run.agent_version_id)
        .eq("org_id", run.org_id)
        .maybeSingle();
      rawConfig = (versionData as VersionRow | null)?.config_json;
    }

    const parsed = RuntimeAgentConfigSchema.safeParse(rawConfig);
    if (!parsed.success) return await fail("AGENT_CONFIG_INVALID");
    const config = parsed.data;

    const providerId = config.provider;
    const provider = getProvider(providerId);
    if (!provider || !provider.isConfigured()) return await fail("PROVIDER_NOT_CONFIGURED");

    const { data: stepData } = await db
      .from("run_steps")
      .insert({
        org_id: run.org_id,
        run_id: runId,
        step_index: 0,
        kind: "model_call",
        status: "running",
        provider: providerId,
        model: config.model,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const stepId = (stepData as { id: string } | null)?.id ?? null;

    const prompt = typeof run.input_json?.prompt === "string" ? run.input_json.prompt : "";

    // Knowledge, scoped to this run's organisation, framed as data.
    const retrieval = await retrieveKnowledge(db, run.org_id, config.knowledgeBaseIds, prompt);
    const knowledge = buildKnowledgeContext(retrieval.chunks);
    const systemPrompt = [
      buildSystemPrompt(config.role, config.instructions, config.goals),
      knowledge,
    ]
      .filter(Boolean)
      .join("\n\n");

    const result: ProviderResult = await provider.complete({
      model: config.model,
      systemPrompt,
      userInput: prompt,
      maxSteps: config.maxSteps,
      maxSpendUsdMicros: Number(run.budget_usd_micros),
      // A hung call must not hold the run past the point recovery would fail
      // it anyway; aborting here lets it settle with its own code instead.
      signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS),
    });

    // Cost first, and from usage rather than from success: a call that was
    // billed and then failed still has to be paid for.
    const usage = result.usage;
    if (usage) {
      // Provider-reported beats the provider's own estimate beats ours. The
      // provider's estimate exists for requests that ran on more than one
      // model (a server-side fallback), where only it knows each attempt's rate.
      const priced =
        result.reportedCostUsdMicros ??
        result.estimatedCostUsdMicros ??
        priceTokens(config.model, usage);
      cost = priced ?? 0;
      const servedModel = (result.ok ? result.servedModel : undefined) ?? config.model;

      await db.from("usage_events").insert({
        org_id: run.org_id,
        run_id: runId,
        step_id: stepId,
        provider: providerId,
        model: servedModel,
        units_json: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(usage.cacheReadInputTokens
            ? { cacheReadInputTokens: usage.cacheReadInputTokens }
            : {}),
          ...(usage.cacheCreationInputTokens
            ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
            : {}),
        },
        cost_usd_micros: cost,
        // Honest about which it is. A bill built from our own arithmetic and
        // presented as the provider's figure would be a fabricated number.
        estimate_source: result.reportedCostUsdMicros === null ? "estimated" : "provider_reported",
        rate_card_version: result.reportedCostUsdMicros === null ? RATE_CARD_VERSION : null,
      });
    }

    if (stepId) {
      await db
        .from("run_steps")
        .update({
          status: result.ok ? "succeeded" : "failed",
          usage_usd_micros: cost,
          error_code: result.ok ? null : result.code,
          // Counts and lengths only. No prompt, no completion.
          summary_json: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                outputChars: result.ok ? result.output.length : 0,
                // Counts only: which knowledge was used is not prompt text,
                // but its content is, and stays out of the trace.
                knowledgeChunks: retrieval.chunks.length,
                ...(retrieval.status === "unavailable" ? { knowledgeUnavailable: true } : {}),
                ...(result.ok && result.truncated ? { truncated: true } : {}),
              }
            : {},
          ended_at: new Date().toISOString(),
        })
        .eq("id", stepId);
    }

    if (!result.ok) {
      if (result.code === "PROVIDER_CANCELLED") {
        logOutcome(runId, result.code);
        const settled = await settle("cancelled", cost, null, result.code);
        return {
          ok: false,
          code: settled ? result.code : "SETTLEMENT_FAILED",
          costUsdMicros: cost,
        };
      }
      return await fail(result.code);
    }

    const settled = await settle(
      "succeeded",
      cost,
      // `truncated` tells the reader the answer stopped at the output cap; an
      // answer cut mid-sentence and presented as complete would mislead.
      {
        output: result.output,
        ...(result.truncated ? { truncated: true } : {}),
        // Source references: the titles of the documents the excerpts came
        // from. Titles only - the excerpts themselves are not stored again.
        ...(retrieval.chunks.length > 0
          ? { sources: [...new Set(retrieval.chunks.map((c) => c.title))].slice(0, 10) }
          : {}),
      },
      null,
    );
    if (!settled) return { ok: false, code: "SETTLEMENT_FAILED", costUsdMicros: cost };
    return { ok: true, costUsdMicros: cost };
  } catch {
    // Our own bug, a dropped connection, anything. The run is ours, so it
    // must still settle or its budget stays reserved. The original error is
    // swallowed deliberately: this often runs detached from any request, and a
    // rethrow would become an unhandled rejection that skips the settlement.
    try {
      return await fail("RUNTIME_ERROR");
    } catch {
      return { ok: false, code: "SETTLEMENT_FAILED", costUsdMicros: cost };
    }
  }
}
