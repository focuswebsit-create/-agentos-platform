import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { CreateOrgSchema } from "@/modules/contracts";
import { ACTIVE_ORG_COOKIE, activeOrgCookieAttributes } from "@/modules/tenancy";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { verifyCsrf } from "@/modules/tenancy/csrf";
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
    selfOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin,
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
    const mapped = mapDatabaseError(error.message);
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
