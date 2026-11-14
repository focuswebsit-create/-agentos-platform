import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/config/env";
import { getSupabaseSecretEnv } from "@/config/env.server";

/**
 * The service-role Supabase client. The ONLY place it is constructed.
 *
 * This credential carries BYPASSRLS: it can read across every tenant, which is
 * exactly why it is confined here. An ESLint rule refuses any import of this
 * module, or of @/config/env.server, from outside src/modules/platform-admin/
 * (see eslint.config.mjs), so the containment is mechanical rather than a
 * convention someone can forget.
 *
 * Rules for every caller, from SECURITY.md 1 and ARCHITECTURE.md boundary 6:
 *   - never reachable from a customer route;
 *   - every query carries an explicit filter, never an unbounded scan;
 *   - every privileged read is audited.
 *
 * Session persistence is off: this client has no user, and writing its
 * credential into any storage would be a leak waiting to happen.
 */
export function createServiceRoleClient() {
  const { url } = getSupabasePublicEnv();
  const { secretKey } = getSupabaseSecretEnv();

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
