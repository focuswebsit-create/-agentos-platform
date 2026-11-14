import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { EmailSchema } from "@/modules/contracts";
import { canAssignRole, type OrgRole } from "@/modules/tenancy";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";
import {
  buildInvitationUrl,
  createInvitationToken,
  invitationExpiry,
} from "@/modules/invitations/token";
import { isAutomaticEmailEnabled } from "@/modules/invitations/email-sender";

const BodySchema = z.object({
  email: EmailSchema,
  role: z.enum(["admin", "member", "viewer"]),
  orgId: z.uuid(),
});

/**
 * POST /api/invitations — issue an invitation.
 *
 * The raw token is generated and hashed here; only the digest is inserted.
 * The link is returned once, in this response, and never stored. If the
 * inviter loses it they revoke and re-issue — which is the correct behaviour
 * for a credential.
 *
 * The seat quota is NOT checked here. A check in application code could be
 * raced by two simultaneous invitations; the BEFORE INSERT trigger in
 * migration 0004 takes a row lock on the organisation and is the only thing
 * that can actually hold the cap. This route simply reports what it says.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "כתובת אימייל או תפקיד לא תקינים.");
  }

  const guard = await guardApi(request, {
    action: "member.invite",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const { context, requestId } = guard;

  // An admin inviting an admin would be a back door around "only an owner
  // appoints admins". Refused here, and again by the RLS policy and the CHECK
  // constraint, so no path reaches the database with an elevated role.
  if (!canAssignRole(context.role, parsed.data.role as OrgRole)) {
    return problem("ORG_ACCESS_DENIED", "אין לכם הרשאה להזמין בתפקיד הזה.", requestId);
  }

  const supabase = await createSupabaseServerClient();

  // Clear out invitations that have lapsed, otherwise the partial unique index
  // on (org_id, email) WHERE status='pending' would block re-inviting someone
  // whose earlier invitation simply expired.
  await supabase.rpc("expire_stale_invitations", { p_org_id: context.orgId });

  const { token, tokenHashLiteral } = createInvitationToken();

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      org_id: context.orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: tokenHashLiteral,
      expires_at: invitationExpiry().toISOString(),
      invited_by: context.userId,
    })
    .select("id, email, role, expires_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return problem("VALIDATION_FAILED", "כבר קיימת הזמנה פתוחה לכתובת הזו.", requestId);
    }
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, requestId);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;

  return okJson(
    {
      invitation: {
        id: data.id,
        email: data.email,
        role: data.role,
        expiresAt: data.expires_at,
      },
      // Shown once. Not persisted, not logged, not placed in the audit record.
      inviteUrl: buildInvitationUrl(siteUrl, token),
      automaticEmail: isAutomaticEmailEnabled(),
      requestId,
    },
    { status: 201 },
  );
}
