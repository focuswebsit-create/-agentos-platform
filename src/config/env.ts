import { z } from "zod";

/**
 * Server-side environment parsing. Only non-secret flags exist in P0.
 * Never add secrets with a NEXT_PUBLIC_ prefix.
 */
const ServerEnvSchema = z.object({
  ADMIN_SHELL_PREVIEW: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse({
    ADMIN_SHELL_PREVIEW: source.ADMIN_SHELL_PREVIEW || undefined,
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL || undefined,
  });
  // Fail closed: an invalid value never enables the admin shell.
  if (!result.success) return { ADMIN_SHELL_PREVIEW: false, NEXT_PUBLIC_SITE_URL: undefined };
  return result.data;
}

export function isAdminShellPreviewEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return parseServerEnv(source).ADMIN_SHELL_PREVIEW;
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
