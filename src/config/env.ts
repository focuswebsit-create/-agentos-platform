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

/**
 * Read from a module-scope constant for the same reason as the Supabase pair
 * below: a parameter defaulting to `process.env` is a dynamic access that the
 * bundler cannot substitute, so the value would be absent in any client bundle
 * that ever reached this. It has no client caller today, which is exactly when
 * a trap like this is cheapest to remove.
 */
const INLINED_SITE_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

export function getSiteUrl(source: Record<string, string | undefined> = INLINED_SITE_ENV) {
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
 * THE TWO READS BELOW MUST STAY EXACTLY AS WRITTEN: a literal
 * `process.env.NEXT_PUBLIC_…` on the right-hand side, at module scope.
 *
 * This is how `NEXT_PUBLIC_*` reaches a browser. Next.js replaces that exact
 * text with the value during the build; it is a textual substitution, not a
 * runtime lookup, because `process.env` does not exist in a browser.
 *
 * This file previously read them as `source.NEXT_PUBLIC_SUPABASE_URL`, with
 * `source` a parameter defaulting to `process.env`. That is a dynamic property
 * access on an object, so the bundler never saw the pattern and substituted
 * nothing — the values were simply absent from the client bundle. Verified: a
 * build with both variables set produced **zero** client chunks containing the
 * URL. The browser client therefore threw "not configured" on every call,
 * whatever was configured on the host.
 *
 * A consequence worth stating, because it looks like a bug when it is not: an
 * inlined value is fixed when the build runs. Setting these variables after a
 * build and restarting the host changes nothing — the new value is not in the
 * bundle, and no restart puts it there. The build has to run with them present.
 * `/diagnostics/config` shows the server's answer and the browser's answer
 * side by side, and they disagree in exactly that case.
 *
 * Values are trimmed. A value pasted into a dashboard field often carries a
 * trailing newline, and `z.url()` rejects "https://x.supabase.co\n" — which
 * then reads as "not configured" and sends everyone looking for a missing
 * variable that is in fact present and correct.
 */
const INLINED_PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

function clean(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Fails closed: without valid Supabase configuration the app refuses to operate rather
 * than falling back to an unauthenticated or misconfigured client.
 *
 * `source` defaults to the inlined values rather than `process.env`, so the
 * browser and the server read the same thing. It stays a parameter only so
 * tests can supply their own.
 */
export function getSupabasePublicEnv(
  source: Record<string, string | undefined> = INLINED_PUBLIC_ENV,
): SupabasePublicEnv {
  const result = SupabasePublicEnvSchema.safeParse({
    url: clean(source.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: clean(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
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
 * A description of the configuration, with no part of any value in it.
 *
 * Four booleans, which is what distinguishes the four situations that all
 * presented as the same "not configured" screen: absent, present but
 * malformed, present but holding the wrong kind of key, and correct.
 *
 * The same function is called from the server and from the browser, and the
 * interesting case is when the two answers DIFFER. On the server these reads
 * resolve against the live process, so a host that has the variables reports
 * them present. In the browser there is no process: the only values that exist
 * are the ones the build substituted into the bundle. A deployment built
 * before the variables were set therefore reports "configured" from the server
 * and "not configured" from the browser — and the browser is the one that has
 * to sign people in.
 *
 * That disagreement is the whole diagnosis, and it is why /diagnostics/config
 * shows both.
 */
export type PublicConfigReport = {
  urlConfigured: boolean;
  urlValid: boolean;
  publishableKeyConfigured: boolean;
  keyFormatValid: boolean;
};

export function describeSupabasePublicEnv(
  source: Record<string, string | undefined> = INLINED_PUBLIC_ENV,
): PublicConfigReport {
  const url = clean(source.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  const single = SupabasePublicEnvSchema.shape;
  const urlValid = url !== undefined && single.url.safeParse(url).success;
  const keyFormatValid = key !== undefined && single.publishableKey.safeParse(key).success;

  return {
    urlConfigured: url !== undefined,
    urlValid,
    publishableKeyConfigured: key !== undefined,
    keyFormatValid,
  };
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
  source: Record<string, string | undefined> = INLINED_PUBLIC_ENV,
): boolean {
  try {
    getSupabasePublicEnv(source);
    return true;
  } catch {
    return false;
  }
}
