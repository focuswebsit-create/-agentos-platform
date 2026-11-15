import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid(), status: z.enum(["open", "handoff", "closed"]) });

/** POST /api/conversations/:id/status — take over (handoff), give back, or close. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/conversations/[id]/status">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה לא תקין.");
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_conversation_status", {
    p_conversation_id: id,
    p_status: parsed.data.status,
  });
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  return okJson({ status: parsed.data.status });
}
