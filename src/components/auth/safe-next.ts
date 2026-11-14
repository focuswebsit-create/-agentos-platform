/**
 * Only same-origin relative paths are accepted as a post-login destination.
 *
 * `?next=` comes straight from the URL, so without this an attacker could send
 * a victim a sign-in link that bounces them to an external look-alike site
 * immediately after they authenticate.
 */
export function safeNext(value: string | null | undefined, fallback = "/app"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  return value;
}
