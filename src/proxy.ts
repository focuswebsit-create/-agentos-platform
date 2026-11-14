import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { carryAuthCookies, updateSession } from "@/modules/supabase/proxy-session";
import { CSRF_COOKIE, csrfCookieAttributes } from "@/modules/tenancy/cookie";

/**
 * Request-level auth boundary. In Next.js 16 this file replaces middleware.ts.
 *
 * It does two things and deliberately no more:
 *
 *   1. Refreshes the Supabase session, which has to happen here because a
 *      refresh writes cookies and Server Components cannot.
 *   2. Turns away requests with no session at all.
 *
 * It is a gate, not the authorization layer. Membership, roles and the
 * platform-admin allowlist are all checked again server-side on every request,
 * and RLS checks them a third time in the database. This file failing open
 * would still not grant access to any tenant's data.
 *
 * The /admin check here is intentionally shallow: deciding whether someone is a
 * platform admin needs the service-role key and a database read, neither of
 * which belongs in a per-request proxy. The /admin layout and every
 * /api/admin route perform the real check, including AAL2.
 */

const SIGN_IN_PATH = "/sign-in";

/** Only same-origin absolute paths survive, so the `next` parameter cannot be used as an open redirect. */
function safeReturnPath(pathname: string, search: string): string {
  const candidate = `${pathname}${search}`;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/app";
  return candidate;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { response, userId } = await updateSession(request);

  const isApp = pathname === "/app" || pathname.startsWith("/app/");
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdmin) {
    // Never confirm that the admin surface exists to someone who cannot use it.
    // A 404 leaks less than a 403.
    if (!userId) {
      const notFound = NextResponse.rewrite(new URL("/_admin-disabled", request.url), {
        status: 404,
      });
      return carryAuthCookies(response, notFound);
    }
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (isApp && !userId) {
    const redirect = new URL(SIGN_IN_PATH, request.url);
    redirect.searchParams.set("next", safeReturnPath(pathname, search));
    return carryAuthCookies(response, NextResponse.redirect(redirect));
  }

  if (isApp) {
    response.headers.set("Cache-Control", "no-store");
  }

  // Every signed-in surface that can POST needs the double-submit token, not
  // just /app: onboarding creates an organisation before any /app page has
  // ever rendered, and /invite accepts one from a brand-new member.
  if (userId) {
    issueCsrfToken(request, response);
  }

  return response;
}

/**
 * Issues the double-submit CSRF token if the browser does not have one yet.
 *
 * It lives here because the proxy is the only place that runs before every app
 * request AND can write cookies. Unlike the session cookie this one is
 * readable by scripts on purpose: the page has to echo it back in a header,
 * and a cross-site attacker cannot read it to do the same.
 */
function issueCsrfToken(request: NextRequest, response: NextResponse) {
  if (request.cookies.get(CSRF_COOKIE)?.value) return;
  const token = randomBytes(32).toString("hex");
  response.cookies.set(CSRF_COOKIE, token, csrfCookieAttributes(process.env.NEXT_PUBLIC_SITE_URL));
}

export const config = {
  matcher: [
    "/app",
    "/app/:path*",
    "/admin",
    "/admin/:path*",
    "/onboarding",
    "/invite/:path*",
    "/sign-in",
    "/sign-up",
    "/reset-password",
  ],
};
