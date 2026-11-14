import "server-only";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/modules/service-role/client";
import { AgentConfigSchema } from "@/modules/contracts";
import { getProvider } from "@/modules/agent-engine/registry";
import { priceTokens, RATE_CARD_VERSION } from "@/modules/agent-engine/rate-card";
import type { ProviderResult } from "@/modules/agent-engine/provider";

/**
 * The execution plane.
 *
 * `ARCHITECTURE.md` keeps this separate from the control plane, and the
 * separation is literal: this module holds the only credential that can write
 * a run's status or its cost, and no customer route can reach those writes
 * except by asking this to perform a run.
 *
 * Three properties the whole file is arranged around:
 *
 *  1. **A dispatched run always settles.** Success, provider failure,
 *     cancellation, an exception in our own code — every path reaches
 *     `settle_run`, which is what returns the reserved budget. A path that did
 *     not would leave the reservation held until the sweeper found it an hour
 *     later, and the tenant's cap smaller until then.
 *  2. **Usage is recorded even when the call failed.** A request that was
 *     billed and then errored still costs money. The provider interface
 *     reports usage on failure for exactly this reason.
 *  3. **Prompt and completion text never reach the database.** `run_steps`
 *     stores kinds, models, counts and costs; `summary_json` is bounded
 *     metadata. The answer goes to `runs.result_json`, which is the customer's
 *     own output, and nothing writes the prompt anywhere.
 *
 * NOT DURABLE YET. `executeRun` is called inline by the dispatch route after
 * the response is sent. If the process dies mid-run, nothing retries it: the
 * run stays `running` until `expire_stale_reservations()` reclaims its budget
 * and marks it `RUN_ABANDONED`. ROADMAP.md's P3 names Inngest for durable
 * execution and that is not wired; this is the honest interim, and the sweeper
 * is what stops the interim costing anyone money.
 */

export type ExecuteOutcome =
  { ok: true; costUsdMicros: number } | { ok: false; code: string; costUsdMicros: number };

type RunRow = {
  id: string;
  org_id: string;
  status: string;
  agent_version_id: string;
  input_json: { prompt?: unknown } | null;
  budget_usd_micros: string | number;
};

type VersionRow = { config_json: unknown };

/** Narrow a provider failure to the short code stored in `runs.error_code`. */
function failureCode(result: Extract<ProviderResult, { ok: false }>): string {
  return result.code;
}

export async function executeRun(runId: string): Promise<ExecuteOutcome> {
  if (!isServiceRoleConfigured()) {
    // Nothing can be written, including a settlement, so there is no safe way
    // to finish the run here. The sweeper will reclaim it.
    return { ok: false, code: "RUNTIME_NOT_CONFIGURED", costUsdMicros: 0 };
  }

  const db = createServiceRoleClient();
  let cost = 0;

  const finish = async (
    status: "succeeded" | "failed" | "cancelled",
    costUsdMicros: number,
    result: unknown,
    errorCode: string | null,
  ) => {
    await db.rpc("settle_run", {
      p_run_id: runId,
      p_status: status,
      p_cost_usd_micros: costUsdMicros,
      p_result: result ?? null,
      p_error_code: errorCode,
    });
  };

  try {
    const { data: runData, error: runError } = await db
      .from("runs")
      .select("id, org_id, status, agent_version_id, input_json, budget_usd_micros")
      .eq("id", runId)
      .maybeSingle();

    if (runError || !runData) return { ok: false, code: "RUN_NOT_FOUND", costUsdMicros: 0 };
    const run = runData as unknown as RunRow;

    // Cancelled between dispatch and pickup. cancel_run already settled the
    // reservation, so this must not settle it again: doing so would credit the
    // period twice.
    if (run.status !== "queued") {
      return { ok: false, code: "RUN_NOT_QUEUED", costUsdMicros: 0 };
    }

    const { data: versionData } = await db
      .from("agent_versions")
      .select("config_json")
      .eq("id", run.agent_version_id)
      .maybeSingle();

    const parsed = AgentConfigSchema.safeParse((versionData as VersionRow | null)?.config_json);
    if (!parsed.success) {
      // A published version that no longer satisfies the schema. Possible after
      // a schema change; the run cannot proceed, and saying which is better
      // than a generic failure.
      await finish("failed", 0, null, "AGENT_CONFIG_INVALID");
      return { ok: false, code: "AGENT_CONFIG_INVALID", costUsdMicros: 0 };
    }
    const config = parsed.data;

    const providerId = config.provider;
    const provider = getProvider(providerId);
    if (!provider || !provider.isConfigured()) {
      await finish("failed", 0, null, "PROVIDER_NOT_CONFIGURED");
      return { ok: false, code: "PROVIDER_NOT_CONFIGURED", costUsdMicros: 0 };
    }

    await db
      .from("runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId);

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

    const result = await provider.complete({
      model: config.model,
      systemPrompt: config.instructions,
      userInput: prompt,
      maxSteps: config.maxSteps,
      maxSpendUsdMicros: Number(run.budget_usd_micros),
    });

    // Cost first, and from usage rather than from success: a call that was
    // billed and then failed still has to be paid for.
    const usage = result.usage;
    if (usage) {
      const priced = result.reportedCostUsdMicros ?? priceTokens(config.model, usage);
      cost = priced ?? 0;

      await db.from("usage_events").insert({
        org_id: run.org_id,
        run_id: runId,
        step_id: stepId,
        provider: providerId,
        model: config.model,
        units_json: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
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
          error_code: result.ok ? null : failureCode(result),
          // Counts and lengths only. No prompt, no completion.
          summary_json: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                outputChars: result.ok ? result.output.length : 0,
              }
            : {},
          ended_at: new Date().toISOString(),
        })
        .eq("id", stepId);
    }

    if (!result.ok) {
      const code = failureCode(result);
      await finish(code === "PROVIDER_CANCELLED" ? "cancelled" : "failed", cost, null, code);
      return { ok: false, code, costUsdMicros: cost };
    }

    await finish("succeeded", cost, { output: result.output }, null);
    return { ok: true, costUsdMicros: cost };
  } catch {
    // Our own bug, a dropped connection, anything. The run must still settle,
    // or its budget stays reserved. The catch deliberately swallows the
    // original error rather than rethrowing it: this runs detached from any
    // request, so a rethrow would become an unhandled rejection and the
    // settlement below would never happen.
    try {
      await finish("failed", cost, null, "RUNTIME_ERROR");
    } catch {
      // Even settlement failed. The sweeper is the backstop; there is nothing
      // further this process can do.
    }
    return { ok: false, code: "RUNTIME_ERROR", costUsdMicros: cost };
  }
}
