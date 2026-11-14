import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { ACTIVE_ORG_COOKIE, activeOrgCookieAttributes } from "@/modules/tenancy";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { verifyCsrf } from "@/modules/tenancy/csrf";
import { hashInvitationTokenLiteral } from "@/modules/invitations/token";
import { mapDatabaseError, newRequestId, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ token: z.string().min(16).max(256) });

/**
 * POST /api/invitations/accept
 *
 * Not guarded by guardApi(): the caller is by definition not yet a member of
 * the organisation they are joining, so there is no membership to check.
 *
 * Everything that matters happens inside accept_invitation(), one transaction:
 * the email must be confirmed AND match the invited address, the invitation
 * must still be pending and unexpired, the seat gate must pass, and the
 * single-use transition is conditional on the row still being pending.
 *
 * Only the digest is sent. The raw token is hashed here and never crosses into
 * the database, so it cannot surface in a query log.
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
    // Deliberately the same answer as a token that does not exist.
    return problem("INVITATION_INVALID", "ההזמנה אינה תקפה.", requestId);
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return problem("AUTH_REQUIRED", "נדרשת התחברות.", requestId);
  }

  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashInvitationTokenLiteral(parsed.data.token),
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, requestId);
  }

  const orgId = data as string;

  const cookieStore = await cookies();
  cookieStore.set(
    ACTIVE_ORG_COOKIE,
    orgId,
    activeOrgCookieAttributes(process.env.NEXT_PUBLIC_SITE_URL),
  );

  return okJson({ orgId, requestId });
}
