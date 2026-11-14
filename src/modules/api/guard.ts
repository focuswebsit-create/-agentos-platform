import type { NextResponse } from "next/server";
import { can, type OrgAction } from "@/modules/tenancy/permissions";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { verifyCsrf } from "@/modules/tenancy/csrf";
import { resolveOrgContext, type OrgContext } from "@/modules/tenancy/context";
import { isFreshOrgContext } from "@/modules/tenancy/context-shared";
import { newRequestId, problem } from "./respond";

/**
 * The server-side half of the two checks DATA_MODEL.md requires.
 *
 * RLS is the other half and runs regardless. This guard exists so a request
 * that will be refused is refused early, with an error a person can act on,
 * instead of surfacing as an empty result set from a policy.
 *
 * Deliberately verifies, in this order, because each step depends on the last:
 *   1. a verified session               -> AUTH_REQUIRED
 *   2. membership of a real organisation -> ORG_ACCESS_DENIED
 *   3. CSRF, for state-changing calls    -> CSRF_INVALID
 *   4. the screen was rendered against this organisation -> STALE_ORG_CONTEXT
 *   5. the role may perform the action   -> ORG_ACCESS_DENIED
 */

export type GuardOptions = {
  /** Permission required; omit for read-only endpoints that only need membership. */
  action?: OrgAction;
  /** True for anything that changes state. Enforces POST + origin + double-submit token. */
  mutation?: boolean;
  /**
   * The organisation id the client screen was rendered with. Required for
   * mutations: it is what detects a workspace switched in another tab.
   */
  submittedOrgId?: string | null;
};

export type GuardResult =
  { ok: true; context: OrgContext; requestId: string } | { ok: false; response: NextResponse };

function selfOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request's own origin
    }
  }
  return new URL(request.url).origin;
}

export async function guardApi(request: Request, options: GuardOptions = {}): Promise<GuardResult> {
  const requestId = newRequestId();

  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") {
    return { ok: false, response: problem("AUTH_REQUIRED", "נדרשת התחברות.", requestId) };
  }
  if (resolution.status === "no_organization") {
    return {
      ok: false,
      response: problem("ORG_ACCESS_DENIED", "אין לכם ארגון פעיל.", requestId),
    };
  }

  const context = resolution.context;

  if (options.mutation) {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookieToken = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CSRF_COOKIE}=`))
      ?.slice(CSRF_COOKIE.length + 1);

    const csrf = verifyCsrf({
      method: request.method,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      selfOrigin: selfOrigin(request),
      cookieToken: cookieToken ? decodeURIComponent(cookieToken) : undefined,
      headerToken: request.headers.get(CSRF_HEADER),
    });

    if (!csrf.ok) {
      return {
        ok: false,
        response: problem(
          "CSRF_INVALID",
          "הבקשה נדחתה מטעמי אבטחה. רעננו את הדף ונסו שוב.",
          requestId,
        ),
      };
    }

    if (!isFreshOrgContext(options.submittedOrgId ?? null, context.orgId)) {
      return {
        ok: false,
        response: problem(
          "STALE_ORG_CONTEXT",
          "הארגון הפעיל השתנה בטאב אחר. רעננו את הדף ונסו שוב.",
          requestId,
        ),
      };
    }

    // A suspended organisation is readable but frozen. Platform admins suspend
    // an account "from new runs with reason" (SUPER_ADMIN.md); content is never
    // destroyed, and the customer can still see it.
    if (context.orgStatus !== "active") {
      return {
        ok: false,
        response: problem("ORG_ACCESS_DENIED", "הארגון מושעה. פנו לתמיכה.", requestId),
      };
    }
  }

  if (options.action && !can(context.role, options.action)) {
    return {
      ok: false,
      response: problem("ORG_ACCESS_DENIED", "אין לכם הרשאה לבצע את הפעולה הזו.", requestId),
    };
  }

  return { ok: true, context, requestId };
}
