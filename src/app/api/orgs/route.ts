import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { CreateOrgSchema, OrgNameSchema } from "@/modules/contracts";
import { z } from "zod";
import { guardApi } from "@/modules/api/guard";
import { ACTIVE_ORG_COOKIE, activeOrgCookieAttributes } from "@/modules/tenancy";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { allowedOrigins, verifyCsrf } from "@/modules/tenancy/csrf";
import { mapDatabaseError, newRequestId, okJson, problem } from "@/modules/api/respond";

/**
 * POST /api/orgs — create an organisation.
 *
 * Not guarded by guardApi(): the caller has no organisation yet, so there is
 * no membership to check. Authority comes from create_organization(), a
 * SECURITY DEFINER function that re-derives the user from auth.uid(), insists
 * on a confirmed email, and creates the organisation and its owner membership
 * in ONE transaction — an organisation without an owner would be invisible to
 * its own creator, because the SELECT policy requires membership.
 */
export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  // Creating an organisation changes state, so it gets the same CSRF
  // treatment as every other mutation. guardApi cannot be reused here because
  // it requires an existing membership, which by definition does not exist yet.
  const csrf = verifyCsrf({
    method: request.method,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    selfOrigin: allowedOrigins(request),
    cookieToken: request.cookies.get(CSRF_COOKIE)?.value,
    headerToken: request.headers.get(CSRF_HEADER),
  });
  if (!csrf.ok) {
    return problem("CSRF_INVALID", "הבקשה נדחתה מטעמי אבטחה. רעננו את הדף ונסו שוב.", requestId);
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return problem("AUTH_REQUIRED", "נדרשת התחברות.", requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.", requestId);
  }

  const parsed = CreateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "שם או מזהה ארגון לא תקינים.", requestId);
  }

  const { data, error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, requestId);
  }

  const orgId = data as string;

  // Make the new organisation active immediately; the cookie is only a
  // pointer, and resolveOrgContext re-verifies the membership on every request.
  const cookieStore = await cookies();
  cookieStore.set(
    ACTIVE_ORG_COOKIE,
    orgId,
    activeOrgCookieAttributes(process.env.NEXT_PUBLIC_SITE_URL),
  );

  return okJson({ orgId, requestId }, { status: 201 });
}

const UpdateOrgSchema = z.object({
  orgId: z.uuid(),
  name: OrgNameSchema,
  locale: z.enum(["he", "en"]),
  timezone: z.string().trim().min(1).max(64),
});

/**
 * PATCH /api/orgs — update the active organisation.
 *
 * Only name, locale and timezone. `seat_limit` and `status` are absent on
 * purpose: migration 0003 withholds the UPDATE column privilege on both, so
 * even if this route tried, PostgreSQL would refuse. A customer cannot raise
 * their own quota or clear their own suspension.
 */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }

  const parsed = UpdateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "פרטי הארגון אינם תקינים.");
  }

  const guard = await guardApi(request, {
    action: "org.update",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({
      name: parsed.data.name,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
    })
    .eq("id", guard.context.orgId)
    .select("id");

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  if (!data || data.length === 0) {
    // RLS refused it, which means the policy is stricter than the guard above.
    return problem("ORG_ACCESS_DENIED", "אין לכם הרשאה לערוך את הארגון.", guard.requestId);
  }

  await supabase.rpc("log_audit", {
    p_org_id: guard.context.orgId,
    p_actor_type: "user",
    p_action: "organization.updated",
    p_entity_type: "organization",
    p_entity_id: guard.context.orgId,
    p_metadata: { locale: parsed.data.locale, timezone: parsed.data.timezone },
  });

  return okJson({ updated: true, requestId: guard.requestId });
}
