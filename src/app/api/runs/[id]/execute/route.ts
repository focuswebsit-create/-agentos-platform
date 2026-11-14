import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { okJson, problem } from "@/modules/api/respond";
import { executeRun } from "@/modules/runtime/executor";
import { isRuntimeConfigured } from "@/modules/runtime/readiness";
import { recoverStaleRuns } from "@/modules/runtime/recovery";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * The executor's worst case is a provider call plus one retry; the platform
 * must not cut the request off before that. 300 s is within Vercel's limit for
 * Node functions with Fluid compute.
 */
export const maxDuration = 300;

/**
 * POST /api/runs/:id/execute — make sure a queued run gets executed.
 *
 * WHY: dispatch starts execution in `after()`, which runs after the response is
 * sent. On serverless platforms that work can be cut short - and when it is,
 * the run used to sit `queued` forever. The run page calls this when a run is
 * still queued a few seconds after dispatch. The request stays open for the
 * whole execution, so nothing depends on background work surviving.
 *
 * SAFE TO CALL ANY NUMBER OF TIMES. `executeRun` claims the run with a
 * conditional update (`status='queued'` → `'running'`); only one caller ever
 * wins. A run that is already running or finished is left alone and its
 * current status returned. It never re-executes a finished run, so it cannot
 * be used to bill a tenant twice.
 *
 * TENANCY: the run is read through the user's own client under RLS, filtered
 * to the organisation the guard resolved. A run in another organisation is
 * invisible here and answers 404 - before the service role is touched - and
 * `executeRun` re-checks the organisation itself.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/runs/[id]/execute">) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה הרצה לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "בקשה לא תקינה.");

  const guard = await guardApi(request, {
    action: "run.start",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;
  const orgId = guard.context.orgId;

  const supabase = await createSupabaseServerClient();
  const { data: visible } = await supabase
    .from("runs")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!visible) {
    return new Response(null, { status: 404 });
  }

  if (!isRuntimeConfigured()) {
    return problem(
      "RUNTIME_NOT_CONFIGURED",
      "סביבת ההרצה אינה מוגדרת בשרת, ולכן ההרצה לא בוצעה.",
      guard.requestId,
    );
  }

  await recoverStaleRuns(orgId);

  const status = (visible as { status: string }).status;
  if (status !== "queued") return okJson({ executed: false, status });

  const outcome = await executeRun(id, { expectedOrgId: orgId });
  return okJson({
    executed: outcome.ok || outcome.code !== "RUN_NOT_QUEUED",
    ok: outcome.ok,
    code: outcome.ok ? null : outcome.code,
  });
}
