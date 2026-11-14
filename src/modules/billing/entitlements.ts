import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import type { PlanCode } from "@/modules/contracts";
import { PLANNED_PLANS } from "./plans";

/**
 * Reads for the billing screen. Every limit comes from ONE place:
 * `effective_entitlements()` (0020), which `start_run` also uses. The screen
 * therefore shows exactly what the server will enforce - never a client-side
 * copy of the rules that could drift from them.
 */

export type Entitlements = {
  /** pilot = never subscribed (today's limits); lapsed = had one, none effective now. */
  source: "pilot" | "subscription" | "lapsed";
  planCode: PlanCode | null;
  planVersion: number | null;
  status: string | null;
  runsAllowed: boolean;
  maxSeats: number | null;
  maxConcurrentRuns: number | null;
  knowledgeBases: number | null;
  monthlyModelBudgetUsdMicros: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type EntitlementsResult =
  | { ok: true; entitlements: Entitlements }
  /** 0020 is not installed on this database yet. */
  | { ok: false; reason: "not_provisioned" }
  | { ok: false; reason: "error" };

const MISSING = ["PGRST202", "PGRST205", "42883", "42P01"];

export async function getEntitlements(orgId: string): Promise<EntitlementsResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("effective_entitlements", { p_org_id: orgId });
  if (error) {
    return MISSING.includes(String(error.code ?? ""))
      ? { ok: false, reason: "not_provisioned" }
      : { ok: false, reason: "error" };
  }
  const raw = data as Record<string, unknown> | null;
  if (!raw) return { ok: false, reason: "error" };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ok: true,
    entitlements: {
      source: raw.source as Entitlements["source"],
      planCode: (raw.planCode as PlanCode | null) ?? null,
      planVersion: num(raw.planVersion),
      status: (raw.status as string | null) ?? null,
      runsAllowed: raw.runsAllowed === true,
      maxSeats: num(raw.maxSeats),
      maxConcurrentRuns: num(raw.maxConcurrentRuns),
      knowledgeBases: num(raw.knowledgeBases),
      monthlyModelBudgetUsdMicros: Number(raw.monthlyModelBudgetUsdMicros ?? 0),
      currentPeriodEnd: (raw.currentPeriodEnd as string | null) ?? null,
      cancelAtPeriodEnd: raw.cancelAtPeriodEnd === true,
    },
  };
}

export type CatalogPlan = {
  code: PlanCode;
  version: number;
  priceMinor: number;
  currency: string;
  maxSeats: number | null;
  maxConcurrentRuns: number | null;
  maxActiveTeams: number | null;
  knowledgeBases: number | null;
  monthlyModelBudgetUsdMicros: number;
  purchasable: boolean;
};

/**
 * The catalog from the database, newest version of each plan. Falls back to
 * the in-code planned catalog (identical values, never purchasable) while 0020
 * is not installed, so the screen stays useful and says nothing untrue.
 */
export async function listCatalog(): Promise<{ plans: CatalogPlan[]; fromDatabase: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plan_versions")
    .select(
      "plan_code, version, price_minor, currency, max_seats, max_concurrent_runs, max_active_teams, knowledge_bases, monthly_model_budget_usd_micros, purchasable",
    )
    .order("price_minor", { ascending: true });

  if (!error && Array.isArray(data) && data.length > 0) {
    const newest = new Map<string, CatalogPlan>();
    for (const r of data as Array<Record<string, unknown>>) {
      const plan: CatalogPlan = {
        code: r.plan_code as PlanCode,
        version: Number(r.version),
        priceMinor: Number(r.price_minor),
        currency: String(r.currency),
        maxSeats: r.max_seats === null ? null : Number(r.max_seats),
        maxConcurrentRuns: r.max_concurrent_runs === null ? null : Number(r.max_concurrent_runs),
        maxActiveTeams: r.max_active_teams === null ? null : Number(r.max_active_teams),
        knowledgeBases: r.knowledge_bases === null ? null : Number(r.knowledge_bases),
        monthlyModelBudgetUsdMicros: Number(r.monthly_model_budget_usd_micros),
        purchasable: r.purchasable === true,
      };
      const current = newest.get(plan.code);
      if (!current || plan.version > current.version) newest.set(plan.code, plan);
    }
    return { plans: [...newest.values()], fromDatabase: true };
  }

  return {
    plans: PLANNED_PLANS.map((p) => ({
      code: p.code,
      version: p.version,
      priceMinor: p.price.amountMinor,
      currency: p.price.currency,
      maxSeats: p.limits.maxSeats,
      maxConcurrentRuns: p.limits.maxConcurrentRuns,
      maxActiveTeams: p.limits.maxActiveTeams,
      knowledgeBases: p.limits.knowledgeBases,
      monthlyModelBudgetUsdMicros: p.limits.monthlyModelBudgetUsdCents * 10_000,
      purchasable: false,
    })),
    fromDatabase: false,
  };
}
