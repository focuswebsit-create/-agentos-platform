import "server-only";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/modules/service-role/client";

/**
 * Reclaims budget held by runs no worker will ever report on.
 *
 * Execution is inline (`after()` in the dispatch route), so a process that dies
 * mid-run leaves its reservation active forever. Without this running on a
 * schedule, every crash permanently shrinks that tenant's monthly cap —
 * silently, and more with each crash. `expire_stale_reservations()` also marks
 * the run `failed` with `RUN_ABANDONED`, so it stops sitting in the UI claiming
 * to be running.
 *
 * Lives here rather than in the route because this is execution-plane work and
 * the service-role credential is confined to this module and the platform-admin
 * boundary. The route's job is to decide whether the caller may ask for it.
 *
 * Safe to run at any time and as often as you like: it only touches
 * reservations whose `expires_at` has already passed, and the SQL takes
 * `for update skip locked` so it never blocks a live dispatch.
 */
export type SweepResult =
  { ok: true; swept: number } | { ok: false; reason: "not_configured" | "failed" };

export async function sweepExpiredReservations(): Promise<SweepResult> {
  if (!isServiceRoleConfigured()) return { ok: false, reason: "not_configured" };

  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("expire_stale_reservations");

  // The driver's message can carry schema detail, so it is not propagated.
  if (error) return { ok: false, reason: "failed" };

  return { ok: true, swept: Number(data ?? 0) };
}
