// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * recoverStaleRuns - closes runs no worker will finish and returns their budget.
 * Vercel Cron does not invoke preview deployments, so on a preview this is the
 * only thing that ever does.
 */

type Query = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown };

const m = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  isServiceRoleConfigured: vi.fn(() => true),
}));
vi.mock("@/modules/service-role/client", () => m);

function fakeDb(opts: {
  queued?: string[];
  running?: string[];
  claimWins?: boolean;
  usage?: Record<string, number[]>;
}) {
  const queries: Query[] = [];
  const rpc: Array<Record<string, unknown>> = [];

  const from = (table: string) => {
    const q: Query = { table, op: "select", filters: {} };
    const result = () => {
      if (table === "runs" && q.op === "select") {
        const ids = q.filters.status === "queued" ? opts.queued : opts.running;
        return { data: (ids ?? []).map((id) => ({ id })), error: null };
      }
      if (table === "runs" && q.op === "update") {
        return { data: opts.claimWins === false ? [] : [{ id: q.filters.id }], error: null };
      }
      if (table === "usage_events") {
        const costs = opts.usage?.[String(q.filters.run_id)] ?? [];
        return { data: costs.map((c) => ({ cost_usd_micros: c })), error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (payload: unknown) => {
        q.op = "update";
        q.payload = payload;
        return chain;
      },
      eq: (col: string, v: unknown) => {
        q.filters[col] = v;
        return chain;
      },
      lt: (col: string, v: unknown) => {
        q.filters[`${col}<`] = v;
        return chain;
      },
      limit: () => chain,
      then: (resolve: (v: unknown) => unknown) => {
        queries.push(q);
        return Promise.resolve(result()).then(resolve);
      },
    };
    return chain;
  };

  return {
    queries,
    rpc,
    client: {
      from,
      rpc: async (_name: string, args: Record<string, unknown>) => {
        rpc.push(args);
        return { data: null, error: null };
      },
    },
  };
}

const ORG = "org-1";

beforeEach(() => {
  m.isServiceRoleConfigured.mockReturnValue(true);
});

describe("recoverStaleRuns", () => {
  it("claims and fails a stale queued run at zero cost", async () => {
    const db = fakeDb({ queued: ["q1"] });
    m.createServiceRoleClient.mockReturnValue(db.client);
    const { recoverStaleRuns } = await import("@/modules/runtime/recovery");
    const result = await recoverStaleRuns(ORG);

    expect(result.recovered).toBe(1);
    const claim = db.queries.find((q) => q.op === "update");
    // The same conditional claim the executor uses, so a late worker cannot
    // also execute it.
    expect(claim?.filters).toMatchObject({ id: "q1", org_id: ORG, status: "queued" });
    expect(db.rpc[0]).toMatchObject({
      p_run_id: "q1",
      p_status: "failed",
      p_cost_usd_micros: 0,
      p_error_code: "RUN_NOT_STARTED",
    });
  });

  it("leaves a queued run alone if a worker claimed it first", async () => {
    const db = fakeDb({ queued: ["q1"], claimWins: false });
    m.createServiceRoleClient.mockReturnValue(db.client);
    const { recoverStaleRuns } = await import("@/modules/runtime/recovery");
    expect((await recoverStaleRuns(ORG)).recovered).toBe(0);
    expect(db.rpc).toHaveLength(0);
  });

  it("fails a stale running run, charging the usage it recorded before it died", async () => {
    const db = fakeDb({ running: ["r1"], usage: { r1: [1200, 300] } });
    m.createServiceRoleClient.mockReturnValue(db.client);
    const { recoverStaleRuns } = await import("@/modules/runtime/recovery");
    await recoverStaleRuns(ORG);
    expect(db.rpc[0]).toMatchObject({
      p_run_id: "r1",
      p_status: "failed",
      p_cost_usd_micros: 1500,
      p_error_code: "RUN_TIMEOUT",
    });
  });

  it("scopes every query to the organisation", async () => {
    const db = fakeDb({ queued: ["q1"], running: ["r1"] });
    m.createServiceRoleClient.mockReturnValue(db.client);
    const { recoverStaleRuns } = await import("@/modules/runtime/recovery");
    await recoverStaleRuns(ORG);
    expect(db.queries.length).toBeGreaterThan(0);
    for (const q of db.queries) expect(q.filters.org_id).toBe(ORG);
  });

  it("only looks at runs past their thresholds, beyond the executor's own deadline", async () => {
    const { RUNNING_STALE_MS, QUEUED_STALE_MS } = await import("@/modules/runtime/recovery");
    const { PROVIDER_DEADLINE_MS } = await import("@/modules/runtime/executor");
    // A live run is never failed by recovery.
    expect(RUNNING_STALE_MS).toBeGreaterThan(PROVIDER_DEADLINE_MS);
    expect(QUEUED_STALE_MS).toBeGreaterThanOrEqual(5 * 60_000);

    const now = Date.parse("2026-11-14T12:00:00Z");
    const db = fakeDb({});
    m.createServiceRoleClient.mockReturnValue(db.client);
    const { recoverStaleRuns } = await import("@/modules/runtime/recovery");
    await recoverStaleRuns(ORG, now);
    const queuedQuery = db.queries.find((q) => q.filters.status === "queued");
    expect(queuedQuery?.filters["created_at<"]).toBe(new Date(now - QUEUED_STALE_MS).toISOString());
  });

  it("does nothing, and does not throw, without the runtime key", async () => {
    m.isServiceRoleConfigured.mockReturnValue(false);
    const { recoverStaleRuns } = await import("@/modules/runtime/recovery");
    await expect(recoverStaleRuns(ORG)).resolves.toEqual({ recovered: 0 });
  });
});
