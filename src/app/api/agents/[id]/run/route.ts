import { after } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { executeRun } from "@/modules/runtime/executor";
import { isRuntimeConfigured } from "@/modules/runtime/readiness";
import { recoverStaleRuns } from "@/modules/runtime/recovery";
import { getAgent } from "@/modules/agents/data";
import { isProviderConfigured } from "@/modules/agent-engine/registry";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

/** after() runs inside this invocation, so it inherits this budget. */
export const maxDuration = 300;

const BodySchema = z.object({
  orgId: z.uuid(),
  prompt: z.string().trim().min(1).max(10_000),
  /** Optional. A client that retries an uncertain dispatch sends the same one. */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

/**
 * POST /api/agents/:id/run — dispatch a run.
 *
 * Two steps, deliberately separate. `start_run()` reserves budget and creates
 * the run inside one transaction, and its result is what the response reports.
 * Execution then happens in `after()`, once the response has been sent.
 *
 * `after()` IS NOT DURABLE. It runs in the same invocation, so a process that
 * dies takes the run with it. What makes that survivable rather than silent is
 * the reservation: `expire_stale_reservations()` reclaims the budget and marks
 * the run `RUN_ABANDONED`, so an abandoned run costs the tenant nothing
 * permanent. ROADMAP.md's P3 names Inngest for durable execution and it is not
 * wired; this is the honest interim and it is recorded as one.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/agents/[id]/run">) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה סוכן לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "יש להזין קלט להרצה.");

  const guard = await guardApi(request, {
    action: "run.start",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  // Both checks come BEFORE start_run, because start_run reserves budget. A
  // run that can never execute must not hold part of the spend cap while it
  // waits for a sweeper - which, without the runtime key, cannot run either.
  if (!isRuntimeConfigured()) {
    return problem(
      "RUNTIME_NOT_CONFIGURED",
      "סביבת ההרצה אינה מוגדרת בשרת, ולכן לא ניתן להריץ. לא נגבתה עלות.",
      guard.requestId,
    );
  }
  const agent = await getAgent(guard.context.orgId, id);
  if (agent?.activeProvider && !isProviderConfigured(agent.activeProvider)) {
    return problem(
      "PROVIDER_NOT_CONFIGURED",
      "ספק המודלים של הגרסה המפורסמת אינו מוגדר בסביבה הזו, ולכן לא ניתן להריץ. לא נגבתה עלות.",
      guard.requestId,
    );
  }
  // An agent that is missing or unpublished falls through: start_run gives the
  // authoritative answer (not found / no version), under RLS.

  // Give back budget held by runs that will never finish, BEFORE the cap is
  // checked - otherwise an abandoned run could make this one look over-limit.
  await recoverStaleRuns(guard.context.orgId);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_run", {
    p_agent_id: id,
    p_input: { prompt: parsed.data.prompt },
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  const dispatch = data as { run_id: string; reused: boolean };

  // Only a fresh run is executed. A reused one is already running or finished,
  // and executing it again would charge the tenant twice for one dispatch —
  // the exact thing the idempotency key exists to prevent.
  if (!dispatch.reused) {
    // Best effort. If this is cut short, the run page's call to
    // /api/runs/:id/execute picks the run up; the claim inside executeRun
    // guarantees the two can never both execute it.
    after(async () => {
      await executeRun(dispatch.run_id, { expectedOrgId: guard.context.orgId });
    });
  }

  return okJson({ runId: dispatch.run_id, reused: dispatch.reused });
}
