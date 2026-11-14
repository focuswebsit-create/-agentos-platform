import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * POST /api/runs/:id/cancel
 *
 * `cancel_run()` releases the reservation and marks the run cancelled in one
 * transaction. Cancelling a run that has already finished is not an error — the
 * caller wanted it stopped and it is stopped — so the response carries the
 * status rather than a failure.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/runs/[id]/cancel">) {
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
    action: "run.cancel",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("cancel_run", { p_run_id: id });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  return okJson({ status: data as string });
}
