import { connection } from "next/server";
import { describeSupabasePublicEnv } from "@/config/env";

/**
 * GET /api/diagnostics/config
 *
 * Four booleans and nothing else. No value, no fragment of a value, no length,
 * no prefix — those would narrow a key, and this endpoint is public.
 *
 * It exists because four different situations all rendered the same
 * "identity service is not configured" screen, and from the outside they were
 * indistinguishable:
 *
 *   - the variable is absent
 *   - it is present but not a URL (a trailing newline from a paste does this)
 *   - it is present but holds a secret key instead of a publishable one
 *   - it is correct, but the BUNDLE was built before it was set
 *
 * The last one is `runtimeAgrees`. NEXT_PUBLIC_* values are substituted into
 * the bundle when the build runs, so setting one afterwards and restarting
 * changes nothing. That reads as "not configured" and is fixed by rebuilding,
 * which is a different action from setting a variable.
 *
 * Deliberately public, and deliberately safe to be public. Whether a
 * deployment is configured is already observable — the sign-in screen says so
 * — and these two variables are shipped to every browser by design. What is
 * not observable here is any part of their contents. Gating it behind a login
 * would also defeat the point: the screen you need it for is the one you
 * cannot get past.
 */
// `dynamic = "force-dynamic"` is rejected under cacheComponents, which this
// project enables. `connection()` is the replacement: awaiting it says the
// response depends on the request, so the result is never prerendered. A cached
// answer here would be worse than no answer — it would report the
// configuration of whichever build happened to produce it.
export async function GET() {
  await connection();
  return Response.json(describeSupabasePublicEnv(), {
    headers: { "cache-control": "no-store" },
  });
}
