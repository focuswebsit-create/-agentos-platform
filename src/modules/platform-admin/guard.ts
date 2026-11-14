import { createSupabaseServerClient } from "@/modules/supabase/server";
import { isSupabaseConfigured } from "@/config/env";
import { hasSupabaseSecretKey } from "@/config/env.server";
import { createServiceRoleClient } from "./client";

/**
 * The platform-admin boundary (SUPER_ADMIN.md "Identity boundary").
 *
 * Super Admin is platform-scoped, NOT an organisation role: being an owner of
 * every customer organisation would still not get you in here. Access requires
 * an active row in platform_admins, and a verified second factor when that row
 * says so.
 *
 * Every failure looks identical to the caller, and /admin answers 404 rather
 * than 403. A 403 confirms the surface exists and that someone is probing the
 * right door; a 404 says nothing.
 *
 * P1 builds this boundary only. The dashboards behind it are P6 (ROADMAP.md),
 * so the screens stay truthfully empty.
 */

export const PLATFORM_ADMIN_ROLES = ["support", "operator", "superadmin"] as const;
export type PlatformAdminRole = (typeof PLATFORM_ADMIN_ROLES)[number];

export type PlatformAdmin = {
  userId: string;
  role: PlatformAdminRole;
  mfaRequired: boolean;
};

export type AdminGuardResult =
  | { ok: true; admin: PlatformAdmin }
  | {
      ok: false;
      /** For server logs only. Never shown to the caller, never changes the HTTP answer. */
      reason: "unauthenticated" | "not_admin" | "mfa_required" | "not_configured" | "lookup_failed";
    };

type PlatformAdminRow = {
  user_id: string;
  role: PlatformAdminRole;
  mfa_required: boolean;
  active: boolean;
};

export async function requirePlatformAdmin(): Promise<AdminGuardResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "not_configured" };
  const supabase = await createSupabaseServerClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return { ok: false, reason: "unauthenticated" };

  // Without a secret key the allowlist cannot be read, so nobody is an admin.
  // Fails closed, and reports a distinct reason so a misconfiguration is not
  // mistaken for an authorisation failure in the logs.
  if (!hasSupabaseSecretKey()) return { ok: false, reason: "not_configured" };

  let row: PlatformAdminRow | null = null;
  try {
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from("platform_admins")
      .select("user_id, role, mfa_required, active")
      .eq("user_id", userId) // explicit filter: never an unbounded scan
      .eq("active", true)
      .maybeSingle();

    if (error) return { ok: false, reason: "lookup_failed" };
    row = (data as PlatformAdminRow | null) ?? null;
  } catch {
    return { ok: false, reason: "lookup_failed" };
  }

  if (!row) return { ok: false, reason: "not_admin" };

  if (row.mfa_required) {
    // aal2 means a second factor was verified for THIS session. Enforced on the
    // server on every request, not merely offered in the UI: a client-side
    // check is a suggestion, not a boundary.
    const aal = typeof claimsData?.claims?.aal === "string" ? claimsData.claims.aal : "aal1";
    if (aal !== "aal2") return { ok: false, reason: "mfa_required" };
  }

  return {
    ok: true,
    admin: { userId: row.user_id, role: row.role, mfaRequired: row.mfa_required },
  };
}

/**
 * Records a privileged admin action. SUPER_ADMIN.md requires every sensitive
 * action to be logged with a reason and a time; log_audit() writes an
 * append-only row that not even the schema owner can amend.
 */
export async function auditAdminAction(input: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  orgId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!hasSupabaseSecretKey()) return;
  try {
    const service = createServiceRoleClient();
    // log_platform_audit, not log_audit: this connection has no JWT, so
    // log_audit's auth.uid() would be null and the row would not name the
    // administrator who acted.
    await service.rpc("log_platform_audit", {
      p_actor_user_id: input.actorUserId,
      p_action: input.action,
      p_entity_type: input.entityType,
      p_org_id: input.orgId ?? null,
      p_entity_id: input.entityId ?? null,
      p_metadata: input.metadata ?? {},
    });
  } catch {
    // Never let an audit failure crash the page. It is reported by the
    // database's own error logs; swallowing it here keeps the boundary usable.
  }
}
