import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";
import { PlanCodeSchema } from "./plan";

/** BILLING_AND_PLANS.md "Subscription state machine". */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "grace",
  "suspended",
  "canceled",
  "expired",
] as const;
export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  planCode: PlanCodeSchema,
  planVersion: z.number().int().positive(),
  provider: z.string().min(1),
  providerCustomerId: z.string().min(1),
  providerSubscriptionId: z.string().min(1),
  status: SubscriptionStatusSchema,
  trialEndsAt: TimestampSchema.nullable(),
  currentPeriodStart: TimestampSchema,
  currentPeriodEnd: TimestampSchema,
  cancelAtPeriodEnd: z.boolean(),
  updatedAt: TimestampSchema,
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

// NOTE: access decisions per state belong to `getEffectiveEntitlements(orgId, now)` (P5),
// never to UI code. Intentionally not implemented in P0.
