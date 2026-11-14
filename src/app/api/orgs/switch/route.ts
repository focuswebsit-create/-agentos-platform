import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ACTIVE_ORG_COOKIE, activeOrgCookieAttributes } from "@/modules/tenancy";
import { listMemberships } from "@/modules/tenancy/context";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { verifyCsrf } from "@/modules/tenancy/csrf";
import { newRequestId, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * POST /api/orgs/switch — change the active workspace.
 *
 * Three CSRF layers apply (POST only, origin check, double-submit token),
 * because switching workspace silently would make every later action in the
 * tab operate on an organisation the user did not choose.
 *
 * Membership is verified before the cookie is written. Writing first and
 * checking later would make the cookie an oracle for which organisation ids
 * exist.
 */
export async function POST(request: NextRequest) {
  const requestId = newRequestId();

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.", requestId);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "מזהה ארגון לא תקין.", requestId);
  }

  const listed = await listMemberships();
  if (!listed) return problem("AUTH_REQUIRED", "נדרשת התחברות.", requestId);

  const target = listed.memberships.find((m) => m.orgId === parsed.data.orgId);
  if (!target) {
    // Same answer whether the organisation does not exist or the user simply
    // is not in it.
    return problem("ORG_ACCESS_DENIED", "אין לכם גישה לארגון הזה.", requestId);
  }

  const cookieStore = await cookies();
  cookieStore.set(
    ACTIVE_ORG_COOKIE,
    target.orgId,
    activeOrgCookieAttributes(process.env.NEXT_PUBLIC_SITE_URL),
  );

  return okJson({ orgId: target.orgId, requestId });
}
