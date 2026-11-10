import type { Id, PlanCode, SubscriptionStatus } from "@/modules/contracts";

/**
 * Provider-agnostic billing adapter (ARCHITECTURE.md "Billing adapter").
 *
 * P0: interface only. There is NO implementation and NO live/sandbox provider.
 * P5 rules (enforced by implementations, not by this file):
 *  - hosted checkout only; never store PAN/CVV;
 *  - webhook signature verified on the RAW body, deduped by (provider, event_id);
 *  - a browser redirect never grants access; only verified server events do;
 *  - prices/plans are resolved server-side, never trusted from the client.
 */
export interface BillingProvider {
  readonly id: string;

  createCheckoutSession(input: {
    orgId: Id;
    userId: Id;
    planCode: PlanCode;
    idempotencyKey: Id;
    returnUrl: string;
  }): Promise<{ providerSessionId: string; hostedUrl: string }>;

  createPortalSession(input: { orgId: Id; returnUrl: string }): Promise<{ hostedUrl: string }>;

  cancelSubscription(input: {
    orgId: Id;
    providerSubscriptionId: string;
    atPeriodEnd: boolean;
  }): Promise<void>;

  /** Must verify the cryptographic signature against the exact raw request body. */
  verifyAndParseWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string>>;
  }): Promise<NormalizedBillingEvent>;

  /** Authoritative provider state for reconciliation of late/reordered events. */
  fetchSubscriptionState(providerSubscriptionId: string): Promise<{
    status: SubscriptionStatus;
    currentPeriodEnd: string;
  }>;
}

export interface NormalizedBillingEvent {
  provider: string;
  eventId: string;
  type:
    | "subscription.activated"
    | "subscription.updated"
    | "subscription.canceled"
    | "payment.succeeded"
    | "payment.failed"
    | "refund.created";
  providerSubscriptionId: string | null;
  occurredAt: string;
}

export type BillingStatus =
  | { state: "not_configured"; reason: "P0_NO_PROVIDER" }
  | { state: "configured"; providerId: string };

/**
 * Truthful billing status for UI. In P0 there is never a provider, so the UI must
 * show "billing unavailable in this environment" (UI_UX_SPEC.md truthful empty states).
 */
export function getBillingStatus(): BillingStatus {
  return { state: "not_configured", reason: "P0_NO_PROVIDER" };
}
