/**
 * Pure tenancy helpers, safe in both a browser and a server bundle.
 *
 * Kept apart from ./context, which reaches for next/headers and the Supabase
 * server client and therefore must never reach the client.
 */

/**
 * Rejects a mutation that was rendered against a different organisation.
 *
 * The active-organisation cookie is shared by every tab, so switching
 * workspace in one tab changes the context of a form already open in another.
 * Without this check that form would silently write to the wrong tenant. The
 * client sends the org id the screen was rendered with, and a mismatch is
 * refused with STALE_ORG_CONTEXT rather than guessed at.
 */
export function isFreshOrgContext(submittedOrgId: string | null, resolvedOrgId: string): boolean {
  if (!submittedOrgId) return false;
  return submittedOrgId === resolvedOrgId;
}
