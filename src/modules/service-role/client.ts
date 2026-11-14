import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/config/env";
import { getSupabaseSecretEnv, hasSupabaseSecretKey } from "@/config/env.server";

/**
 * The service-role Supabase client. The ONLY place it is constructed.
 *
 * This credential carries BYPASSRLS: it can read across every tenant, which is
 * exactly why it is confined here.
 *
 * ARCHITECTURE.md names two authorities that legitimately need it, and they are
 * different things: the platform-admin boundary, which reads across tenants on
 * purpose, and the execution plane, which writes run state and spend that no
 * customer may write. It used to live inside the platform-admin module, so the
 * executor would have had to import from there and pretend to be an
 * administrator. It is its own module now, with both callers named explicitly.
 *
 * An ESLint rule refuses any import of this module from outside
 * src/modules/platform-admin/ and src/modules/runtime/, and refuses
 * @/config/env.server from anywhere but here (see eslint.config.mjs), so the
 * containment is mechanical rather than a convention someone can forget.
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

/**
 * Whether a service-role client can be constructed at all.
 *
 * Callers used to ask `hasSupabaseSecretKey()` directly, which is the wrong
 * question in the wrong place: what a caller needs to know is whether THIS
 * module can work, not which environment variable happens to back it. Asking
 * here also keeps `@/config/env.server` reachable from exactly one file.
 */
export function isServiceRoleConfigured(): boolean {
  return hasSupabaseSecretKey();
}
