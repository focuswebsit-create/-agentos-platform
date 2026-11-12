import { z } from "zod";

/**
 * SERVER-ONLY environment. Never import this from a Client Component.
 *
 * The Supabase secret key resolves to the `service_role` Postgres role, which carries
 * BYPASSRLS. It is the one credential in this project that can read across tenants, so:
 *
 *   - it has no NEXT_PUBLIC_ prefix and is never inlined into a client bundle;
 *   - it is only reachable from `src/modules/platform-admin/` (enforced by an ESLint
 *     import restriction, not by convention);
 *   - its value is never logged, never put in an error message, and never sent to a model.
 *
 * See SECURITY.md clause 7 and CLAUDE.md rule 5.
 */

const SupabaseSecretEnvSchema = z.object({
  secretKey: z
    .string()
    .min(20)
    .refine((v) => !v.startsWith("sb_publishable_"), {
      message: "SUPABASE_SECRET_KEY holds a publishable key — it cannot bypass RLS",
    }),
});

export type SupabaseSecretEnv = z.infer<typeof SupabaseSecretEnvSchema>;

/** Names that would leak a secret into the client bundle if they ever existed. */
const FORBIDDEN_PUBLIC_SECRET_NAMES = [
  "NEXT_PUBLIC_SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_KEY",
] as const;

/**
 * Reads the Supabase secret key.
 *
 * Fails closed in three ways: it refuses to run in a browser, refuses to run when a
 * secret has been given a browser-exposed name, and refuses to return a malformed key.
 * No failure path includes the value itself.
 */
export function getSupabaseSecretEnv(
  source: Record<string, string | undefined> = process.env,
): SupabaseSecretEnv {
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseSecretEnv() was called in the browser — refusing.");
  }

  for (const name of FORBIDDEN_PUBLIC_SECRET_NAMES) {
    if (source[name]) {
      throw new Error(
        `${name} is set. A secret under a NEXT_PUBLIC_ name is inlined into the client ` +
          "bundle. Remove it and use SUPABASE_SECRET_KEY instead.",
      );
    }
  }

  const result = SupabaseSecretEnvSchema.safeParse({ secretKey: source.SUPABASE_SECRET_KEY });

  if (!result.success) {
    throw new Error(
      "SUPABASE_SECRET_KEY is missing or invalid. It is required only for platform-admin " +
        "reads; customer paths must never need it. Values are never logged.",
    );
  }
  return result.data;
}

/**
 * Whether platform-admin features can operate at all. Lets callers return a truthful
 * "not configured" instead of throwing on a path a customer can reach.
 */
export function hasSupabaseSecretKey(
  source: Record<string, string | undefined> = process.env,
): boolean {
  if (typeof window !== "undefined") return false;
  try {
    getSupabaseSecretEnv(source);
    return true;
  } catch {
    return false;
  }
}
