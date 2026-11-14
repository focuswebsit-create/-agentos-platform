import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/config/env";

/**
 * Supabase client for Client Components.
 *
 * Uses the publishable key, which resolves to the `anon` / `authenticated`
 * Postgres role, so every statement it issues is subject to RLS. Nothing this
 * client can do is trusted by the server: API routes and Server Components
 * re-derive the user and re-check org membership on every request
 * (DATA_MODEL.md: "RLS AND backend tenant membership checks").
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient(url, publishableKey);
}
