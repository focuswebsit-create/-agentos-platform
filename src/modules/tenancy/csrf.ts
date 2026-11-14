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
  /** The origin this deployment is served from. */
  selfOrigin: string;
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
      return new URL(origin).origin === new URL(selfOrigin).origin;
    } catch {
      return false;
    }
  }

  return false;
}

export type CsrfCheckResult = { ok: true } | { ok: false; reason: string };

export function verifyCsrf(input: {
  method: string;
  origin: string | null;
  secFetchSite: string | null;
  selfOrigin: string;
  cookieToken: string | undefined;
  headerToken: string | null;
}): CsrfCheckResult {
  if (input.method.toUpperCase() !== "POST") {
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
