import { z } from "zod";
import { MoneySchema } from "./common";

export const PlanCodeSchema = z.enum(["starter", "business", "pro"]);
export type PlanCode = z.infer<typeof PlanCodeSchema>;

/** `null` = no fixed product-level count (anti-abuse limits still apply). */
const LimitSchema = z.number().int().positive().nullable();

/** Entitlement keys (BILLING_AND_PLANS.md "Entitlement engine"). */
export const PlanLimitsSchema = z.object({
  maxSeats: LimitSchema,
  maxActiveTeams: LimitSchema,
  maxConcurrentRuns: LimitSchema,
  knowledgeBases: LimitSchema,
  /** Included direct model-cost ceiling per month, USD cents. Not credits. */
  monthlyModelBudgetUsdCents: z.number().int().nonnegative(),
  /** Unlimited agent *definitions* only. */
  agentDefinitions: z.literal(null),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export const PlanVersionSchema = z.object({
  code: PlanCodeSchema,
  version: z.number().int().positive(),
  billingInterval: z.literal("month"),
  /** Price excluding VAT. */
  price: MoneySchema,
  vatIncluded: z.literal(false),
  limits: PlanLimitsSchema,
  /**
   * `planned` = price hypothesis for validation; nobody can purchase it.
   * `purchasable` may only be set after P5 sandbox + owner approval.
   */
  availability: z.enum(["planned", "purchasable"]),
});
export type PlanVersion = z.infer<typeof PlanVersionSchema>;
