// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/runs/:id/execute - the recovery kick for a run left queued when
 * the dispatch request's after() was cut short.
 *
 * What must hold:
 *  - a run in another organisation is invisible (404) BEFORE the service role
 *    is touched;
 *  - a run that is not queued is never executed again (no double billing);
 *  - a queued run is executed with the caller's organisation pinned.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "44444444-4444-4444-8444-444444444444";

const m = vi.hoisted(() => ({
  visible: { id: "44444444-4444-4444-8444-444444444444", status: "queued" } as {
    id: string;
    status: string;
  } | null,
  executeRun: vi.fn(async () => ({ ok: true, costUsdMicros: 5 })),
  recoverStaleRuns: vi.fn(async () => ({ recovered: 0 })),
  isRuntimeConfigured: vi.fn(() => true),
  orgFilter: [] as string[],
}));

vi.mock("@/modules/api/guard", () => ({
  guardApi: vi.fn(async () => ({
    ok: true,
    context: { orgId: ORG, userId: "u", role: "member" },
    requestId: "33333333-3333-4333-8333-333333333333",
  })),
}));
vi.mock("@/modules/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const chain = {
      select: () => chain,
      eq: (col: string, value: string) => {
        if (col === "org_id") m.orgFilter.push(value);
        return chain;
      },
      maybeSingle: async () => ({ data: m.visible, error: null }),
    };
    return { from: () => chain };
  },
}));
vi.mock("@/modules/runtime/executor", () => ({ executeRun: m.executeRun }));
vi.mock("@/modules/runtime/recovery", () => ({ recoverStaleRuns: m.recoverStaleRuns }));
vi.mock("@/modules/runtime/readiness", () => ({ isRuntimeConfigured: m.isRuntimeConfigured }));

async function post() {
  const { POST } = await import("@/app/api/runs/[id]/execute/route");
  const request = new Request(`https://agentos.test/api/runs/${RUN}/execute`, {
    method: "POST",
    body: JSON.stringify({ orgId: ORG }),
    headers: { "content-type": "application/json" },
  });
  return POST(request as never, { params: Promise.resolve({ id: RUN }) } as never);
}

beforeEach(() => {
  m.visible = { id: RUN, status: "queued" };
  m.executeRun.mockClear();
  m.recoverStaleRuns.mockClear();
  m.isRuntimeConfigured.mockReturnValue(true);
  m.orgFilter = [];
});

describe("POST /api/runs/:id/execute", () => {
  it("executes a queued run, pinned to the caller's organisation", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.executeRun).toHaveBeenCalledWith(RUN, { expectedOrgId: ORG });
    expect(m.orgFilter).toContain(ORG);
  });

  it("answers 404 for a run it cannot see - another organisation's - and never executes it", async () => {
    m.visible = null;
    const res = await post();
    expect(res.status).toBe(404);
    expect(m.executeRun).not.toHaveBeenCalled();
    expect(m.recoverStaleRuns).not.toHaveBeenCalled();
  });

  for (const status of ["running", "succeeded", "failed", "cancelled"]) {
    it(`never re-executes a ${status} run`, async () => {
      m.visible = { id: RUN, status };
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ executed: false, status });
      expect(m.executeRun).not.toHaveBeenCalled();
    });
  }

  it("refuses with RUNTIME_NOT_CONFIGURED without the runtime key", async () => {
    m.isRuntimeConfigured.mockReturnValue(false);
    const res = await post();
    expect(res.status).toBe(503);
    expect(m.executeRun).not.toHaveBeenCalled();
  });

  it("allows itself enough time for a full provider call", async () => {
    const route = await import("@/app/api/runs/[id]/execute/route");
    expect(route.maxDuration).toBeGreaterThanOrEqual(300);
  });
});
