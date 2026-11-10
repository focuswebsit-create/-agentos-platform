import { PlanVersionSchema, type PlanCode, type PlanVersion } from "@/modules/contracts";

/**
 * Planned plan catalog — source: BILLING_AND_PLANS.md "Proposed prices".
 * These are HYPOTHESES for validation, excluding VAT. They are display-only:
 * `availability: "planned"` means no checkout exists and nothing can be purchased.
 * In P5 this moves to immutable `plan_versions` rows in the database.
 */
const RAW_PLANS = [
  {
    code: "starter",
    version: 1,
    billingInterval: "month",
    price: { amountMinor: 299_00, currency: "ILS" },
    vatIncluded: false,
    limits: {
      maxSeats: 1,
      maxActiveTeams: 1,
      maxConcurrentRuns: 1,
      knowledgeBases: 1,
      monthlyModelBudgetUsdCents: 5_00,
      agentDefinitions: null,
    },
    availability: "planned",
  },
  {
    code: "business",
    version: 1,
    billingInterval: "month",
    price: { amountMinor: 799_00, currency: "ILS" },
    vatIncluded: false,
    limits: {
      maxSeats: 5,
      maxActiveTeams: 5,
      maxConcurrentRuns: 3,
      knowledgeBases: 5,
      monthlyModelBudgetUsdCents: 20_00,
      agentDefinitions: null,
    },
    availability: "planned",
  },
  {
    code: "pro",
    version: 1,
    billingInterval: "month",
    price: { amountMinor: 1990_00, currency: "ILS" },
    vatIncluded: false,
    limits: {
      maxSeats: 15,
      maxActiveTeams: null,
      maxConcurrentRuns: 10,
      knowledgeBases: 20,
      monthlyModelBudgetUsdCents: 60_00,
      agentDefinitions: null,
    },
    availability: "planned",
  },
] as const satisfies readonly PlanVersion[];

export const PLANNED_PLANS: readonly PlanVersion[] = RAW_PLANS.map((p) =>
  PlanVersionSchema.parse(p),
);

export function getPlannedPlan(code: PlanCode): PlanVersion {
  const plan = PLANNED_PLANS.find((p) => p.code === code);
  if (!plan) throw new Error(`Unknown plan code: ${code}`);
  return plan;
}

/** Plan highlighted in the pricing UI (presentation only). */
export const HIGHLIGHTED_PLAN: PlanCode = "business";
