import "server-only";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/modules/service-role/client";
import { PROVIDER_DEADLINE_MS } from "./executor";

/**
 * Fails runs that no worker will ever finish, and gives their budget back.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT ONLY A CRON JOB
 *
 * Execution starts in the dispatch request's `after()`. If that invocation is
 * cut short, or the run page's recovery kick never arrives, the run stays
 * `queued` (or `running`) holding part of the organisation's spend cap. The
 * hourly reservation expiry is scheduled by Vercel Cron - and **Vercel Cron only
 * invokes Production deployments, never Previews.** On a preview, nothing
 * would ever reclaim it.
 *
 * So this runs lazily, scoped to one organisation, from the places that
 * organisation's own requests already pass through: dispatching a run, opening
 * the runs list, kicking a run. A tenant whose run was abandoned gets its
 * budget back the next time anyone in it touches runs, on any deployment.
 *
 * WHAT IT DOES
 *
 *  - **queued for longer than QUEUED_STALE_MS**: claimed first (the same
 *    conditional update the executor uses), so a worker that wakes up late
 *    cannot also execute it; then failed `RUN_NOT_STARTED` at zero cost.
 *  - **running for longer than RUNNING_STALE_MS**: failed `RUN_TIMEOUT`,
 *    charging whatever usage the executor recorded before it died - a call that
 *    was billed is still paid for. The threshold is well beyond the
 *    executor's own deadline, so a live run is never failed under it.
 *
 * Every query carries an explicit `org_id` filter (the service-role rule), and
 * it touches only runs that are already past their thresholds.
 */

export const QUEUED_STALE_MS = 10 * 60_000;
export const RUNNING_STALE_MS = PROVIDER_DEADLINE_MS + 3 * 60_000;
const BATCH = 25;

export type RecoveryResult = { recovered: number };

export async function recoverStaleRuns(orgId: string, now = Date.now()): Promise<RecoveryResult> {
  if (!isServiceRoleConfigured()) return { recovered: 0 };

  let db: ReturnType<typeof createServiceRoleClient>;
  try {
    db = createServiceRoleClient();
  } catch {
    return { recovered: 0 };
  }

  let recovered = 0;
  try {
    const queuedBefore = new Date(now - QUEUED_STALE_MS).toISOString();
    const { data: queued } = await db
      .from("runs")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "queued")
      .lt("created_at", queuedBefore)
      .limit(BATCH);

    for (const row of (queued ?? []) as Array<{ id: string }>) {
      const { data: claimed } = await db
        .from("runs")
        .update({ status: "running", started_at: new Date(now).toISOString() })
        .eq("id", row.id)
        .eq("org_id", orgId)
        .eq("status", "queued")
        .select("id");
      if (!Array.isArray(claimed) || claimed.length === 0) continue;

      const { error } = await db.rpc("settle_run", {
        p_run_id: row.id,
        p_status: "failed",
        p_cost_usd_micros: 0,
        p_result: null,
        p_error_code: "RUN_NOT_STARTED",
      });
      if (!error) recovered++;
    }

    const runningBefore = new Date(now - RUNNING_STALE_MS).toISOString();
    const { data: running } = await db
      .from("runs")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "running")
      .lt("started_at", runningBefore)
      .limit(BATCH);

    for (const row of (running ?? []) as Array<{ id: string }>) {
      const { data: events } = await db
        .from("usage_events")
        .select("cost_usd_micros")
        .eq("org_id", orgId)
        .eq("run_id", row.id);
      const spent = ((events ?? []) as Array<{ cost_usd_micros: number | string }>).reduce(
        (sum, e) => sum + Number(e.cost_usd_micros ?? 0),
        0,
      );

      const { error } = await db.rpc("settle_run", {
        p_run_id: row.id,
        p_status: "failed",
        p_cost_usd_micros: spent,
        p_result: null,
        p_error_code: "RUN_TIMEOUT",
      });
      if (!error) recovered++;
    }
  } catch {
    // Recovery is opportunistic; the request that triggered it must not fail
    // because of it. The hourly expiry remains the backstop on production.
  }

  if (recovered > 0) console.error(`[runtime] org=${orgId} recovered_stale_runs=${recovered}`);
  return { recovered };
}
