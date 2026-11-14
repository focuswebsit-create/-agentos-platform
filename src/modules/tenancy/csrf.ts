/**
 * CSRF protection for state-changing requests, in three independent layers
 * (owner requirement on decision 2).
 *
 *   1. POST only. Switching workspace is never a navigation, so it can never be
 *      triggered by a link, an image or a prefetch.
 *   2. Origin / Sec-Fetch-Site must say the request came from this site.
 *   3. Double-submit token: a random value in a readable cookie must match the
 *      same value in a request header. A cross-site attacker can make the
 *      browser send the cookie, but cannot read it to set the header.
 *
 * SameSite=Lax on the cookie already stops the main attack. These layers exist
 * because the cookie attribute alone fails if a browser gets it wrong or a
 * future route is reached in a way Lax does not cover.
 */

export const CSRF_TOKEN_BYTES = 32;

/** Constant-time comparison: a length-or-prefix leak here is a usable oracle. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type OriginCheckInput = {
  /** The `Origin` header, if the browser sent one. */
  origin: string | null;
  /** The `Sec-Fetch-Site` header, if the browser sent one. */
  secFetchSite: string | null;
  /**
   * The origin(s) this deployment answers on. Usually the request's own origin
   * and, if configured, NEXT_PUBLIC_SITE_URL - see `allowedOrigins()`.
   */
  selfOrigin: string | readonly string[];
};

/**
 * Accepts only requests the browser says are same-origin.
 *
 * Fails CLOSED when neither header is present: a request that reveals nothing
 * about where it came from is not evidence that it came from here.
 */
export function isSameOriginRequest({
  origin,
  secFetchSite,
  selfOrigin,
}: OriginCheckInput): boolean {
  if (secFetchSite) {
    if (secFetchSite === "same-origin") return true;
    if (secFetchSite === "cross-site" || secFetchSite === "same-site") return false;
    // "none" means a user-initiated navigation, which a POST endpoint never is.
    if (secFetchSite === "none") return false;
  }

  if (origin) {
    try {
      const presented = new URL(origin).origin;
      const allowed = (typeof selfOrigin === "string" ? [selfOrigin] : selfOrigin).map(
        (o) => new URL(o).origin,
      );
      return allowed.includes(presented);
    } catch {
      return false;
    }
  }

  return false;
}

export type CsrfCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * The methods a state-changing endpoint may be called with.
 *
 * This used to be "POST, and nothing else". The rule came from P1's workspace
 * switch, where the point was that a GET - a navigation, a prefetch, an <img
 * src> - must never change anything. That intent is right and is kept: GET,
 * HEAD and OPTIONS are refused below, as is any method not on this list.
 *
 * But it was written into this shared check as "anything that is not POST is
 * refused", and every endpoint added afterwards that used PATCH, PUT or DELETE
 * was rejected on every legitimate request with CSRF_INVALID. Seven of them:
 * saving an agent's details, saving its draft, the organisation settings form,
 * changing a member's role, removing a member, and two Super Admin actions.
 * Publishing failed too, because the editor saves before it publishes. Nothing
 * caught it because no test had ever sent a VALID non-POST mutation through
 * this function - only invalid ones, which a check that rejects everything
 * passes with flying colours.
 *
 * Allowing PATCH, PUT and DELETE weakens nothing. A cross-site HTML form can
 * only send GET or POST, so those three cannot be forged by a form at all; a
 * cross-site fetch() using them triggers a CORS preflight that this app never
 * answers. They are, if anything, harder to forge than the POST that was always
 * allowed. The origin check and the double-submit token below still apply to
 * every one of them.
 */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutationMethod(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

export function verifyCsrf(input: {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  selfOrigin: string | readonly string[];
  cookieToken: string | undefined;
  headerToken: string | null;
}): CsrfCheckResult {
  if (!isMutationMethod(input.method)) {
    return { ok: false, reason: "method_not_allowed" };
  }
  if (!isSameOriginRequest(input)) {
    return { ok: false, reason: "cross_origin" };
  }
  if (!input.cookieToken || !input.headerToken) {
    return { ok: false, reason: "missing_token" };
  }
  if (!timingSafeEqualHex(input.cookieToken, input.headerToken)) {
    return { ok: false, reason: "token_mismatch" };
  }
  return { ok: true };
}

/**
 * The origins a request may legitimately come from: the one it was sent to,
 * plus NEXT_PUBLIC_SITE_URL when that is configured.
 *
 * This replaces five copies of a `selfOrigin()` helper spread across the API
 * routes, which did not even agree with each other. Most of them returned the
 * configured site URL INSTEAD of the request's origin. On a Vercel preview -
 * where every deployment has its own URL plus a branch alias, and
 * NEXT_PUBLIC_SITE_URL usually names production - a browser that sends no
 * `Sec-Fetch-Site` header would have had its same-origin request compared
 * against production's origin and refused.
 *
 * Accepting the request's own origin is the definition of same-origin, not a
 * relaxation of it. A cross-site attacker cannot make a browser send an
 * `Origin` that matches the host the request is going to: a page on evil.test
 * calling this app sends `Origin: https://evil.test` and is refused exactly as
 * before. The double-submit token is checked independently of this.
 */
export function allowedOrigins(request: Request): string[] {
  const own = new URL(request.url).origin;
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return [own];
  try {
    const site = new URL(configured).origin;
    return site === own ? [own] : [own, site];
  } catch {
    // A malformed configured value is ignored rather than trusted.
    return [own];
  }
}
