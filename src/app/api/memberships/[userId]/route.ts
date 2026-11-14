import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { canManageMember, type OrgRole } from "@/modules/tenancy";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const PatchSchema = z.object({
  orgId: z.uuid(),
  role: z.enum(["admin", "member", "viewer"]),
});
const DeleteSchema = z.object({ orgId: z.uuid() });

async function loadTargetRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as OrgRole | undefined) ?? null;
}

/** PATCH /api/memberships/:userId — change a member's role. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/memberships/[userId]">) {
  const { userId } = await ctx.params;
  if (!z.uuid().safeParse(userId).success) {
    return problem("VALIDATION_FAILED", "מזהה משתמש לא תקין.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "תפקיד לא תקין.");

  // PATCH, so the CSRF helper's POST-only rule cannot be reused directly;
  // guardApi is told this is a mutation and checks origin and token, while the
  // method itself is constrained by the route export.
  const guard = await guardApi(
    new Request(request.url, { method: "POST", headers: request.headers }),
    {
      action: "member.changeRole",
      mutation: true,
      submittedOrgId: parsed.data.orgId,
    },
  );
  if (!guard.ok) return guard.response;

  const targetRole = await loadTargetRole(guard.context.orgId, userId);
  if (!targetRole) return problem("ORG_ACCESS_DENIED", "החבר לא נמצא.", guard.requestId);

  if (
    !canManageMember({
      actorRole: guard.context.role,
      actorUserId: guard.context.userId,
      targetRole,
      targetUserId: userId,
      nextRole: parsed.data.role as OrgRole,
    })
  ) {
    return problem("ORG_ACCESS_DENIED", "אין לכם הרשאה לשנות את התפקיד הזה.", guard.requestId);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ role: parsed.data.role })
    .eq("org_id", guard.context.orgId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    const mapped = mapDatabaseError(error.message);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  if (!data || data.length === 0) {
    // RLS refused it. The server check above and the policy disagreed, which
    // means the policy is the stricter of the two - as intended.
    return problem("ORG_ACCESS_DENIED", "אין לכם הרשאה לשנות את התפקיד הזה.", guard.requestId);
  }

  await supabase.rpc("log_audit", {
    p_org_id: guard.context.orgId,
    p_actor_type: "user",
    p_action: "membership.role_changed",
    p_entity_type: "membership",
    p_entity_id: null,
    p_metadata: { target_user_id: userId, new_role: parsed.data.role },
  });

  return okJson({ updated: true, requestId: guard.requestId });
}

/** DELETE /api/memberships/:userId — remove someone from the organisation. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/memberships/[userId]">) {
  const { userId } = await ctx.params;
  if (!z.uuid().safeParse(userId).success) {
    return problem("VALIDATION_FAILED", "מזהה משתמש לא תקין.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "בקשה לא תקינה.");

  const guard = await guardApi(
    new Request(request.url, { method: "POST", headers: request.headers }),
    {
      action: "member.remove",
      mutation: true,
      submittedOrgId: parsed.data.orgId,
    },
  );
  if (!guard.ok) return guard.response;

  const targetRole = await loadTargetRole(guard.context.orgId, userId);
  if (!targetRole) return problem("ORG_ACCESS_DENIED", "החבר לא נמצא.", guard.requestId);

  if (
    !canManageMember({
      actorRole: guard.context.role,
      actorUserId: guard.context.userId,
      targetRole,
      targetUserId: userId,
    })
  ) {
    return problem("ORG_ACCESS_DENIED", "אין לכם הרשאה להסיר את החבר הזה.", guard.requestId);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("org_id", guard.context.orgId)
    .eq("user_id", userId);

  if (error) {
    // The deferred owner-guard trigger raises here when this would leave the
    // organisation without an owner.
    const mapped = mapDatabaseError(error.message);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  await supabase.rpc("log_audit", {
    p_org_id: guard.context.orgId,
    p_actor_type: "user",
    p_action: "membership.removed",
    p_entity_type: "membership",
    p_entity_id: null,
    p_metadata: { target_user_id: userId },
  });

  return okJson({ removed: true, requestId: guard.requestId });
}
