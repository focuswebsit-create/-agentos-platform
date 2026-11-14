import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { isSupabaseConfigured } from "@/config/env";
import { ACTIVE_ORG_COOKIE } from "./cookie";
import type { OrgRole } from "./permissions";

/**
 * The single place the active organisation is decided.
 *
 * Everything that needs to know "which tenant is this request about" goes
 * through here, so a future move to org-scoped URLs (/app/[orgSlug]/...)
 * changes the source of the id in ONE function instead of in every route.
 *
 * The cookie is only a hint. The membership row and the role are re-read from
 * the database on every call, so a forged cookie buys nothing: it can only
 * name an organisation, and naming one you are not a member of silently falls
 * back to a default. It never errors, because an error would confirm that the
 * organisation exists.
 */

export type Membership = {
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: OrgRole;
  orgStatus: "active" | "suspended";
  orgLocale: "he" | "en";
  orgTimezone: string;
};

export type OrgContext = {
  userId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: OrgRole;
  orgStatus: "active" | "suspended";
  orgLocale: "he" | "en";
  orgTimezone: string;
  /** Every organisation this user belongs to, for the workspace switcher. */
  memberships: readonly Membership[];
  /** True when the cookie named an organisation the user cannot access. */
  cookieWasStale: boolean;
};

export type OrgResolution =
  | { status: "ok"; context: OrgContext }
  | { status: "unauthenticated" }
  | { status: "no_organization"; userId: string };

type MembershipRow = {
  org_id: string;
  role: OrgRole;
  organizations: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "suspended";
    locale: "he" | "en";
    timezone: string;
  } | null;
};

export async function listMemberships(): Promise<{
  userId: string;
  memberships: Membership[];
} | null> {
  // An unconfigured identity service means nobody is authenticated. Returning
  // null makes callers treat this exactly like a signed-out visitor, instead
  // of throwing a 500 that both breaks the page and advertises the
  // misconfiguration.
  if (!isSupabaseConfigured()) return null;

  const supabase = await createSupabaseServerClient();

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) return null;

  // RLS restricts this to the caller's own rows; the explicit user_id filter is
  // the second of the two checks DATA_MODEL.md requires, not a substitute.
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, organizations!inner(id, slug, name, status, locale, timezone)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return { userId, memberships: [] };

  const memberships = ((data ?? []) as unknown as MembershipRow[])
    .filter(
      (
        row,
      ): row is MembershipRow & { organizations: NonNullable<MembershipRow["organizations"]> } =>
        row.organizations !== null,
    )
    .map((row) => ({
      orgId: row.org_id,
      orgSlug: row.organizations.slug,
      orgName: row.organizations.name,
      role: row.role,
      orgStatus: row.organizations.status,
      orgLocale: row.organizations.locale,
      orgTimezone: row.organizations.timezone,
    }));

  return { userId, memberships };
}

export async function resolveOrgContext(): Promise<OrgResolution> {
  const listed = await listMemberships();
  if (!listed) return { status: "unauthenticated" };

  const { userId, memberships } = listed;
  if (memberships.length === 0) return { status: "no_organization", userId };

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  const matched = requested ? memberships.find((m) => m.orgId === requested) : undefined;
  // Silent fallback. Returning 403 here would turn the cookie into an oracle
  // for discovering which organisation ids exist.
  const active = matched ?? memberships[0]!;

  return {
    status: "ok",
    context: {
      userId,
      orgId: active.orgId,
      orgSlug: active.orgSlug,
      orgName: active.orgName,
      role: active.role,
      orgStatus: active.orgStatus,
      orgLocale: active.orgLocale,
      orgTimezone: active.orgTimezone,
      memberships,
      cookieWasStale: Boolean(requested) && !matched,
    },
  };
}
