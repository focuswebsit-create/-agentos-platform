import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

/**
 * Deliberately only name and description.
 *
 * `status` and `active_version_id` are absent because 0007 grants no privilege
 * on either column: publishing and archiving are state transitions that have to
 * move more than one row, so they are RPCs. A request carrying them would be
 * refused by PostgreSQL whatever this route did, and the schema says the same
 * thing the grant does.
 */
const UpdateAgentSchema = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable(),
});

export async function PATCH(request: NextRequest, context: RouteContext<"/api/agents/[id]">) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה סוכן לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = UpdateAgentSchema.safeParse(body);
  if (!parsed.success)
    return problem("VALIDATION_FAILED", "שם הסוכן חייב להכיל בין 2 ל-120 תווים.");

  const guard = await guardApi(request, {
    action: "agent.update",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  // The org filter is redundant with RLS and kept deliberately: both of the
  // checks DATA_MODEL.md requires are present on every query.
  const { data, error } = await supabase
    .from("agents")
    .update({ name: parsed.data.name, description: parsed.data.description })
    .eq("id", id)
    .eq("org_id", guard.context.orgId)
    .select("id")
    .maybeSingle();

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  // No row updated means the agent is invisible to this user or archived. Both
  // answer the same way, so the response cannot be used to tell them apart.
  if (!data) {
    return problem("ORG_ACCESS_DENIED", "לא נמצא סוכן שניתן לעדכן.", guard.requestId);
  }

  return okJson({ id });
}
