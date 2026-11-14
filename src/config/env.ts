import { z } from "zod";

/**
 * Server-side environment parsing. Never add secrets with a NEXT_PUBLIC_ prefix.
 *
 * P0's ADMIN_SHELL_PREVIEW flag is gone. It hid /admin behind an environment
 * variable because there was no authentication yet; P1 replaces it with a real
 * platform-admin check (an active row in platform_admins plus AAL2), so a flag
 * that could expose the surface by being set to the wrong value no longer
 * exists to be set wrongly.
 */
const ServerEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse({
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL || undefined,
  });
  // Fail closed: an unparseable value is treated as absent, never as valid.
  if (!result.success) return { NEXT_PUBLIC_SITE_URL: undefined };
  return result.data;
}

export function getSiteUrl(source: Record<string, string | undefined> = process.env) {
  return parseServerEnv(source).NEXT_PUBLIC_SITE_URL;
}

/* -------------------------------------------------------------------------- */
/*  Supabase public configuration (P1)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Browser-safe Supabase configuration.
 *
 * The publishable key resolves to the `anon` / `authenticated` Postgres role, so every
 * request made with it stays subject to RLS. It is safe to ship to the browser.
 *
 * Supabase is deprecating the legacy JWT `anon` / `service_role` keys by the end of 2026,
 * so this project standardises on the newer `sb_publishable_` / `sb_secret_` key model.
 */
const SupabasePublicEnvSchema = z.object({
  url: z.url(),
  publishableKey: z
    .string()
    .min(20)
    // A secret key in a NEXT_PUBLIC_ variable would be inlined into the client bundle.
    // Refuse to start rather than ship it.
    .refine((v) => !v.startsWith("sb_secret_"), {
      message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key — never expose it",
    }),
});

export type SupabasePublicEnv = z.infer<typeof SupabasePublicEnvSchema>;

/**
 * Fails closed: without valid Supabase configuration the app refuses to operate rather
 * than falling back to an unauthenticated or misconfigured client.
 */
export function getSupabasePublicEnv(
  source: Record<string, string | undefined> = process.env,
): SupabasePublicEnv {
  const result = SupabasePublicEnvSchema.safeParse({
    url: source.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!result.success) {
    throw new Error(
      "Supabase public environment is invalid. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example). Values are never logged.",
    );
  }
  return result.data;
}

/**
 * Whether Supabase is configured, without throwing.
 *
 * A deployment missing these variables must degrade safely, not answer 500 on
 * every authenticated route. A 500 on /admin is worse than useless: it
 * confirms the route exists and advertises a misconfiguration. Callers use
 * this to fall back to "no session", which makes /app redirect to sign-in and
 * /admin answer 404 — the same answers an anonymous visitor gets.
 */
export function isSupabaseConfigured(
  source: Record<string, string | undefined> = process.env,
): boolean {
  try {
    getSupabasePublicEnv(source);
    return true;
  } catch {
    return false;
  }
}
