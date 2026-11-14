import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * POST /api/invitations/:id/revoke
 *
 * A status transition, never a DELETE: SECURITY.md 4 treats deletion as a
 * sensitive operation and the record is what proves the invitation existed
 * and who withdrew it.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/invitations/[id]/revoke">,
) {
  const { id } = await context.params;

  const idCheck = z.uuid().safeParse(id);
  if (!idCheck.success) return problem("VALIDATION_FAILED", "מזהה הזמנה לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "בקשה לא תקינה.");

  const guard = await guardApi(request, {
    action: "invitation.revoke",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();

  // The org_id filter is redundant with RLS and kept deliberately: the two
  // checks DATA_MODEL.md requires are both present on every query.
  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", idCheck.data)
    .eq("org_id", guard.context.orgId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  if (!data || data.length === 0) {
    return problem("INVITATION_INVALID", "ההזמנה כבר אינה ממתינה.", guard.requestId);
  }

  await supabase.rpc("log_audit", {
    p_org_id: guard.context.orgId,
    p_actor_type: "user",
    p_action: "invitation.revoked",
    p_entity_type: "invitation",
    p_entity_id: idCheck.data,
    p_metadata: {},
  });

  return okJson({ revoked: true, requestId: guard.requestId });
}
