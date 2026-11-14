// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rpcResult: { data: null as unknown, error: null as null | { code?: string; message?: string } },
  catalogResult: { data: null as unknown, error: null as null | { code?: string } },
}));

vi.mock("@/modules/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const chain = {
      select: () => chain,
      order: async () => m.catalogResult,
    };
    return { rpc: async () => m.rpcResult, from: () => chain };
  },
}));

beforeEach(() => {
  m.rpcResult = { data: null, error: null };
  m.catalogResult = { data: null, error: null };
});

describe("getEntitlements", () => {
  it("returns exactly what the server resolved", async () => {
    m.rpcResult = {
      data: {
        source: "subscription",
        planCode: "starter",
        planVersion: 1,
        status: "active",
        runsAllowed: true,
        maxSeats: 1,
        maxConcurrentRuns: 1,
        knowledgeBases: 1,
        monthlyModelBudgetUsdMicros: "5000000",
        currentPeriodEnd: "2026-12-14T00:00:00Z",
        cancelAtPeriodEnd: false,
      },
      error: null,
    };
    const { getEntitlements } = await import("@/modules/billing/entitlements");
    const r = await getEntitlements("org");
    expect(r).toEqual({
      ok: true,
      entitlements: expect.objectContaining({
        source: "subscription",
        planCode: "starter",
        maxConcurrentRuns: 1,
        monthlyModelBudgetUsdMicros: 5_000_000,
      }),
    });
  });

  it("says 'not provisioned' when 0020 is not installed, rather than inventing limits", async () => {
    m.rpcResult = { data: null, error: { code: "PGRST202", message: "no function" } };
    const { getEntitlements } = await import("@/modules/billing/entitlements");
    expect(await getEntitlements("org")).toEqual({ ok: false, reason: "not_provisioned" });
  });

  it("reports a generic error for anything else (e.g. not a member)", async () => {
    m.rpcResult = { data: null, error: { code: "42501", message: "ORG_ACCESS_DENIED" } };
    const { getEntitlements } = await import("@/modules/billing/entitlements");
    expect(await getEntitlements("org")).toEqual({ ok: false, reason: "error" });
  });
});

describe("listCatalog", () => {
  it("uses the newest version of each plan from the database", async () => {
    m.catalogResult = {
      data: [
        {
          plan_code: "starter",
          version: 1,
          price_minor: 29900,
          currency: "ILS",
          max_seats: 1,
          max_concurrent_runs: 1,
          max_active_teams: 1,
          knowledge_bases: 1,
          monthly_model_budget_usd_micros: 5000000,
          purchasable: false,
        },
        {
          plan_code: "starter",
          version: 2,
          price_minor: 34900,
          currency: "ILS",
          max_seats: 2,
          max_concurrent_runs: 1,
          max_active_teams: 1,
          knowledge_bases: 1,
          monthly_model_budget_usd_micros: 6000000,
          purchasable: false,
        },
      ],
      error: null,
    };
    const { listCatalog } = await import("@/modules/billing/entitlements");
    const { plans, fromDatabase } = await listCatalog();
    expect(fromDatabase).toBe(true);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ code: "starter", version: 2, priceMinor: 34900 });
  });

  it("falls back to the planned catalog - never purchasable - when the table is missing", async () => {
    m.catalogResult = { data: null, error: { code: "PGRST205" } };
    const { listCatalog } = await import("@/modules/billing/entitlements");
    const { plans, fromDatabase } = await listCatalog();
    expect(fromDatabase).toBe(false);
    expect(plans.map((p) => p.code)).toEqual(["starter", "business", "pro"]);
    expect(plans.every((p) => p.purchasable === false)).toBe(true);
    // Same figures as BILLING_AND_PLANS.md and migration 0020.
    expect(plans.find((p) => p.code === "starter")?.monthlyModelBudgetUsdMicros).toBe(5_000_000);
  });
});

describe("limit errors reach the user as actionable messages", () => {
  it.each([
    ["SUBSCRIPTION_INACTIVE", 402],
    ["RUN_CONCURRENCY_LIMIT", 429],
    ["USAGE_LIMIT_REACHED", 402],
  ])("%s", async (code, status) => {
    const { mapDatabaseError, problem } = await import("@/modules/api/respond");
    const mapped = mapDatabaseError({ message: code, code: "P0001" });
    expect(mapped.code).toBe(code);
    expect(mapped.message.length).toBeGreaterThan(10);
    expect(problem(mapped.code, mapped.message).status).toBe(status);
  });
});
