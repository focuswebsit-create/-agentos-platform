import { describe, expect, it } from "vitest";
import {
  formatMoney,
  getBillingStatus,
  getPlannedPlan,
  HIGHLIGHTED_PLAN,
  PLANNED_PLANS,
} from "@/modules/billing";
import { PlanVersionSchema } from "@/modules/contracts";

describe("planned plan catalog (BILLING_AND_PLANS.md)", () => {
  it("contains exactly Starter, Business and Pro", () => {
    expect(PLANNED_PLANS.map((p) => p.code)).toEqual(["starter", "business", "pro"]);
  });

  it("matches the documented monthly ILS prices in integer minor units, excluding VAT", () => {
    expect(getPlannedPlan("starter").price).toEqual({ amountMinor: 29900, currency: "ILS" });
    expect(getPlannedPlan("business").price).toEqual({ amountMinor: 79900, currency: "ILS" });
    expect(getPlannedPlan("pro").price).toEqual({ amountMinor: 199000, currency: "ILS" });
    for (const plan of PLANNED_PLANS) {
      expect(Number.isInteger(plan.price.amountMinor)).toBe(true);
      expect(plan.vatIncluded).toBe(false);
      expect(plan.billingInterval).toBe("month");
    }
  });

  it("matches the documented limits table", () => {
    expect(getPlannedPlan("starter").limits).toMatchObject({
      maxSeats: 1,
      maxActiveTeams: 1,
      maxConcurrentRuns: 1,
      monthlyModelBudgetUsdCents: 500,
      knowledgeBases: 1,
    });
    expect(getPlannedPlan("business").limits).toMatchObject({
      maxSeats: 5,
      maxActiveTeams: 5,
      maxConcurrentRuns: 3,
      monthlyModelBudgetUsdCents: 2000,
      knowledgeBases: 5,
    });
    expect(getPlannedPlan("pro").limits).toMatchObject({
      maxSeats: 15,
      maxActiveTeams: null,
      maxConcurrentRuns: 10,
      monthlyModelBudgetUsdCents: 6000,
      knowledgeBases: 20,
    });
  });

  it("allows unlimited agent definitions only — never unlimited model budget", () => {
    for (const plan of PLANNED_PLANS) {
      expect(plan.limits.agentDefinitions).toBeNull();
      expect(plan.limits.monthlyModelBudgetUsdCents).toBeGreaterThan(0);
    }
  });

  it("marks every plan as planned (not purchasable) in P0", () => {
    expect(PLANNED_PLANS.every((p) => p.availability === "planned")).toBe(true);
  });

  it("every plan passes the shared schema and the highlighted plan exists", () => {
    for (const plan of PLANNED_PLANS) expect(PlanVersionSchema.safeParse(plan).success).toBe(true);
    expect(PLANNED_PLANS.some((p) => p.code === HIGHLIGHTED_PLAN)).toBe(true);
  });

  it("rejects floating-point money", () => {
    const bad = { ...getPlannedPlan("starter"), price: { amountMinor: 299.5, currency: "ILS" } };
    expect(PlanVersionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("billing status", () => {
  it("is never configured in P0 (truthful 'billing unavailable')", () => {
    expect(getBillingStatus()).toEqual({ state: "not_configured", reason: "P0_NO_PROVIDER" });
  });
});

describe("formatMoney", () => {
  it("formats ILS minor units for display", () => {
    const he = formatMoney({ amountMinor: 79900, currency: "ILS" }, "he");
    expect(he).toContain("799");
    expect(he).toContain("₪");
    expect(formatMoney({ amountMinor: 199000, currency: "ILS" }, "en")).toContain("1,990");
  });

  it("shows cents only when needed", () => {
    expect(formatMoney({ amountMinor: 500, currency: "USD" }, "en")).toBe("$5");
    expect(formatMoney({ amountMinor: 550, currency: "USD" }, "en")).toBe("$5.50");
  });
});
