import { timingSafeEqual } from "node:crypto";

/**
 * The shared secret that authenticates scheduled internal calls.
 *
 * A file of its own, not another export of `@/config/env.server`, and the
 * reason is the ESLint containment in `eslint.config.mjs`. Ring 1 exists so the
 * Supabase secret — the one credential that can read across tenants — has
 * exactly one reader. Adding a second secret to that module would mean
 * whichever file needs the cron secret could also reach the BYPASSRLS key.
 *
 * One secret per file, each with its own browser guard, and the lint rules name
 * each exemption explicitly.
 *
 * This secret is far less dangerous than the Supabase one: the worst an
 * attacker holding it can do is make the reservation sweeper run, which only
 * releases budget that has already expired. It still gets constant-time
 * comparison and a fail-closed default, because "low value" is not a reason to
 * build the habit of doing it loosely.
 */

const MIN_LENGTH = 24;

function read(source: Record<string, string | undefined>): string | null {
  if (typeof window !== "undefined") return null;
  const value = source.AGENTOS_CRON_SECRET;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Short enough to brute force is the same as absent, and treating it as
  // absent means the endpoint 404s rather than standing open behind a token
  // someone picked in a hurry.
  return trimmed.length >= MIN_LENGTH ? trimmed : null;
}

/** Whether scheduled internal endpoints are enabled at all. */
export function hasCronSecret(source: Record<string, string | undefined> = process.env): boolean {
  return read(source) !== null;
}

/**
 * Constant-time comparison of a presented token against the configured secret.
 *
 * Returns false when nothing is configured, so an endpoint that forgets to
 * check `hasCronSecret()` first still refuses rather than admitting everyone.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * length through the exception, so the lengths are compared first and the
 * result is combined — an early return on length is unavoidable here, and the
 * length of a secret is not the part worth protecting.
 */
export function matchesCronSecret(
  presented: string | null | undefined,
  source: Record<string, string | undefined> = process.env,
): boolean {
  const expected = read(source);
  if (expected === null || typeof presented !== "string") return false;

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
