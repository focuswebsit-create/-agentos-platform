"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/modules/supabase/browser";

/**
 * The single way the auth screens talk to Supabase.
 *
 * It exists because all five of them had the same defect, and it was the one
 * users actually hit:
 *
 *     setPending(true);
 *     const supabase = createSupabaseBrowserClient();   // throws when unconfigured
 *     const { error } = await supabase.auth.signInWithPassword(...);  // rejects on network failure
 *
 * Neither line was inside a try/catch. A throw from either became an unhandled
 * rejection, `setPending(false)` was never reached, and the button sat on
 * "רגע…" forever with nothing on screen to explain it. On a deployment whose
 * `NEXT_PUBLIC_SUPABASE_*` variables are absent, that happened on the very
 * first click, every time.
 *
 * Three guarantees, each one a thing that was missing:
 *
 *  1. **It never throws.** Every path returns a result, so the caller's
 *     `finally` always runs and the spinner always stops.
 *  2. **It times out.** A request that never answers is indistinguishable from
 *     a frozen page, and Supabase's auth methods take no AbortSignal.
 *  3. **It distinguishes "not configured" from "network failed".** The first
 *     is an operator's problem and no amount of retrying fixes it; telling the
 *     user to try again would be a lie.
 */

/** Long enough for a slow mobile connection, short enough to not read as frozen. */
export const AUTH_TIMEOUT_MS = 15_000;

export type AuthFailure =
  /** The deployment has no Supabase configuration. Retrying cannot help. */
  | { ok: false; kind: "not_configured" }
  /** No answer within AUTH_TIMEOUT_MS. */
  | { ok: false; kind: "timeout" }
  /** The request threw: offline, DNS, CORS, TLS. */
  | { ok: false; kind: "network" };

export type AuthResult<T> = { ok: true; data: T } | AuthFailure;

/**
 * Runs `fn` with a browser Supabase client.
 *
 * NOTE ON THE TIMEOUT: `Promise.race` reports the timeout; it does not cancel
 * the underlying request, which may still complete afterwards. For sign-in
 * that is harmless — a session that arrives late is simply a session, and the
 * next page load picks it up. It is called out here rather than hidden,
 * because a reader who assumes cancellation would use this for something where
 * a late completion matters.
 */
export async function callAuth<T>(
  fn: (supabase: SupabaseClient) => Promise<T>,
  timeoutMs: number = AUTH_TIMEOUT_MS,
): Promise<AuthResult<T>> {
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseBrowserClient();
  } catch {
    // getSupabasePublicEnv() throws when the variables are missing or
    // malformed. Deliberately not surfaced as a network error: the user can
    // retry a network error, and retrying this would waste their time.
    return { ok: false, kind: "not_configured" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<AuthFailure>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, kind: "timeout" }), timeoutMs);
    });

    const work = fn(supabase).then((data): AuthResult<T> => ({ ok: true, data }));

    return await Promise.race([work, timeout]);
  } catch {
    return { ok: false, kind: "network" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The message for a failure that is the same on every screen. */
export function authFailureMessage(
  failure: AuthFailure,
  errors: { notConfigured: string; timeout: string; network: string },
): string {
  switch (failure.kind) {
    case "not_configured":
      return errors.notConfigured;
    case "timeout":
      return errors.timeout;
    case "network":
      return errors.network;
  }
}
