import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/config/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Still the publishable key, so RLS applies here too. The service-role key is
 * never used on a customer-reachable path; it lives in
 * src/modules/platform-admin/ and an ESLint rule keeps it there.
 *
 * Reading cookies makes the calling route dynamic. That is intended: an
 * authenticated page must never be served from a shared cache.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so dropping the write here is safe.
        }
      },
    },
  });
}

/**
 * The verified identity of the current request, or null.
 *
 * Uses getClaims(), which validates the token. `getSession()` must never be
 * trusted on the server: the session cookie is attacker-controllable, so
 * trusting it unverified would let anyone render another user's page.
 */
export async function getVerifiedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}
