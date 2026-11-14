import "server-only";
import { createServiceRoleClient, isServiceRoleConfigured } from "@/modules/service-role/client";
import { hasCronSecret } from "@/config/cron.server";
import { anthropicKeyPresent, isLiveAiEnabled } from "@/modules/agent-engine/providers/anthropic";
import { isMockProviderEnabled } from "@/modules/agent-engine/registry";

/**
 * Whether the execution plane can record and settle a run on this deployment.
 *
 * A boolean, exported from `runtime/` so a route can ask without importing the
 * service-role client itself (which the ESLint ring forbids it to do).
 *
 * Asked BEFORE a run is dispatched. Without the secret key the executor can
 * write nothing - not the result, not the settlement - and recovery needs the
 * same key. A run dispatched here would sit queued holding part of the
 * tenant's spend cap.
 */
export function isRuntimeConfigured(): boolean {
  return isServiceRoleConfigured();
}

export type RuntimeHealth = {
  /** SUPABASE_SECRET_KEY is present and well-formed. */
  runtimeKeyPresent: boolean;
  /**
   * The key was actually ACCEPTED by the database just now. Present-but-wrong
   * (a key from another project, a revoked key, a stray character) is the
   * failure that leaves runs queued with no trace, and only a live probe
   * tells it apart from "present".
   */
  runtimeKeyAccepted: boolean;
  anthropicKeyPresent: boolean;
  liveAiEnabled: boolean;
  simulationEnabled: boolean;
  /** AGENTOS_CRON_SECRET present and at least 24 characters. */
  cronSecretValid: boolean;
};

/**
 * Booleans only - never a value, a length or a prefix. Shown to an
 * organisation's owners and admins on the runs screens, so that a run that
 * cannot execute explains itself without anyone reading server logs.
 */
export async function getRuntimeHealth(orgId: string): Promise<RuntimeHealth> {
  const runtimeKeyPresent = isServiceRoleConfigured();
  let runtimeKeyAccepted = false;

  if (runtimeKeyPresent) {
    try {
      const db = createServiceRoleClient();
      // A one-row read filtered to the caller's own organisation: the cheapest
      // query that proves the key is accepted, and still org-scoped.
      const { error } = await db.from("runs").select("id").eq("org_id", orgId).limit(1);
      runtimeKeyAccepted = !error;
    } catch {
      runtimeKeyAccepted = false;
    }
  }

  return {
    runtimeKeyPresent,
    runtimeKeyAccepted,
    anthropicKeyPresent: anthropicKeyPresent(),
    liveAiEnabled: isLiveAiEnabled(),
    simulationEnabled: isMockProviderEnabled(),
    cronSecretValid: hasCronSecret(),
  };
}
