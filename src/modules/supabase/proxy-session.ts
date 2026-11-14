import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/config/env";

export type ProxySession = {
  /**
   * The response that carries any refreshed auth cookies. It MUST be the one
   * returned from the proxy, or whose cookies are copied onto a redirect:
   * an earlier response does not carry them, and the user is signed out on the
   * next request.
   */
  response: NextResponse;
  /** Verified user id, or null when there is no valid session. */
  userId: string | null;
};

/**
 * Refreshes the Supabase session for a request and reports who the caller is.
 *
 * Identity comes from getClaims(), which verifies the token. getSession() is
 * never used here: the session cookie is attacker-controllable, so trusting it
 * unverified would let anyone present themselves as another user.
 *
 * This runs in the proxy (Next.js 16's rename of middleware) because a token
 * refresh has to write cookies, which Server Components cannot do.
 */
export async function updateSession(request: NextRequest): Promise<ProxySession> {
  let response = NextResponse.next({ request });

  const { url, publishableKey } = getSupabasePublicEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Nothing may run between creating the client and this call: it is what
  // performs the refresh and populates the cookies above.
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims?.sub) userId = data.claims.sub;
  } catch {
    // A transport failure must not hand out access. Treated as "no session",
    // so protected routes redirect rather than render.
    userId = null;
  }

  return { response, userId };
}

/**
 * Copies the refreshed auth cookies onto another response.
 *
 * Needed whenever the proxy answers with a redirect or a rewrite instead of the
 * response updateSession() built, so the refresh is not lost.
 */
export function carryAuthCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}
