/**
 * The active-organisation cookie (approved decision 2).
 *
 * THE COOKIE IS NOT A SOURCE OF AUTHORITY. It is a pointer: "the workspace this
 * person last chose". Authority is the `memberships` table, and the last line
 * of defence is RLS. A forged or stolen value grants nothing — resolveOrgContext()
 * re-reads the membership and the role from the database on every request, and
 * falls back silently when the cookie names an organisation the user is not in.
 *
 * It therefore carries a bare UUID: no role, no permissions, nothing worth
 * tampering with and nothing that would be believed if it were.
 */

export const ACTIVE_ORG_COOKIE = "agentos_active_org";

/** Anti-CSRF token for the org-switch endpoint; readable by JS by design (double submit). */
export const CSRF_COOKIE = "agentos_csrf";
export const CSRF_HEADER = "x-agentos-csrf";

export type CookieAttributes = {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * `secure` is derived from the deployment URL rather than NODE_ENV: a staging
 * build served over HTTPS must still set it, and a local HTTP origin must not,
 * or the browser silently drops the cookie and the workspace never sticks.
 */
export function isSecureOrigin(siteUrl: string | undefined): boolean {
  if (!siteUrl) return true; // Unknown origin: assume HTTPS rather than weaken the cookie.
  try {
    return new URL(siteUrl).protocol === "https:";
  } catch {
    return true;
  }
}

export function activeOrgCookieAttributes(siteUrl: string | undefined): CookieAttributes {
  return {
    httpOnly: true,
    // Lax already blocks the cookie on a cross-site POST, which is the attack
    // that matters for the switch endpoint. The CSRF token is defence in depth.
    sameSite: "lax",
    secure: isSecureOrigin(siteUrl),
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  };
}

/** The CSRF cookie must be readable by the client, so it is the one that is not httpOnly. */
export function csrfCookieAttributes(siteUrl: string | undefined): CookieAttributes {
  return {
    httpOnly: false,
    sameSite: "lax",
    secure: isSecureOrigin(siteUrl),
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  };
}
