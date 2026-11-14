import "server-only";
import { isServiceRoleConfigured } from "@/modules/service-role/client";

/**
 * Whether the execution plane can record and settle a run on this deployment.
 *
 * A boolean, exported from `runtime/` so a route can ask without importing the
 * service-role client itself (which the ESLint ring forbids it to do).
 *
 * Asked BEFORE a run is dispatched. Without the secret key the executor can
 * write nothing - not the result, not the settlement - and the sweeper that
 * would reclaim the reservation needs the same key. A run dispatched here would
 * sit queued holding part of the tenant's spend cap indefinitely.
 */
export function isRuntimeConfigured(): boolean {
  return isServiceRoleConfigured();
}
