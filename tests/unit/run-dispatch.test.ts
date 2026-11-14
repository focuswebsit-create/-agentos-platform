// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextServer from "next/server";

/**
 * POST /api/agents/:id/run refuses BEFORE start_run when the run could never
 * execute. start_run reserves budget; a run dispatched without a runtime key or
 * a configured provider would hold part of the tenant's spend cap while queued,
 * and without the runtime key even the sweeper could not release it.
 *
 * Collaborators are mocked at module boundaries, so the route's own control
 * flow runs unchanged.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

const m = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { run_id: "run-1", reused: false }, error: null })),
  isRuntimeConfigured: vi.fn(() => true),
  isProviderConfigured: vi.fn(() => true),
  getAgent: vi.fn(
    async () => ({ activeProvider: "anthropic" }) as { activeProvider: string | null },
  ),
  executeRun: vi.fn(async () => ({ ok: true, costUsdMicros: 1 })),
}));

vi.mock("@/modules/api/guard", () => ({
  guardApi: vi.fn(async () => ({
    ok: true,
    context: { orgId: ORG, userId: "u", role: "member" },
    requestId: "33333333-3333-4333-8333-333333333333",
  })),
}));
vi.mock("@/modules/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: m.rpc }),
}));
vi.mock("@/modules/runtime/readiness", () => ({ isRuntimeConfigured: m.isRuntimeConfigured }));
vi.mock("@/modules/runtime/executor", () => ({ executeRun: m.executeRun }));
vi.mock("@/modules/agents/data", () => ({ getAgent: m.getAgent }));
vi.mock("@/modules/agent-engine/registry", () => ({
  isProviderConfigured: m.isProviderConfigured,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  after: vi.fn(),
}));

async function post() {
  const { POST } = await import("@/app/api/agents/[id]/run/route");
  const request = new Request(`https://agentos.test/api/agents/${AGENT}/run`, {
    method: "POST",
    body: JSON.stringify({ orgId: ORG, prompt: "שלום" }),
    headers: { "content-type": "application/json" },
  });
  return POST(request as never, { params: Promise.resolve({ id: AGENT }) } as never);
}

beforeEach(() => {
  m.rpc.mockClear();
  m.isRuntimeConfigured.mockReturnValue(true);
  m.isProviderConfigured.mockReturnValue(true);
  m.getAgent.mockResolvedValue({ activeProvider: "anthropic" });
});

describe("run dispatch readiness", () => {
  it("dispatches when the runtime and the version's provider are both ready", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("start_run", expect.anything());
  });

  it("refuses with RUNTIME_NOT_CONFIGURED, and reserves nothing, without the runtime key", async () => {
    m.isRuntimeConfigured.mockReturnValue(false);
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("RUNTIME_NOT_CONFIGURED");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses with PROVIDER_NOT_CONFIGURED, and reserves nothing, when the version's provider cannot be called", async () => {
    m.isProviderConfigured.mockReturnValue(false);
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(m.isProviderConfigured).toHaveBeenCalledWith("anthropic");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("leaves an unpublished agent to start_run, which answers authoritatively under RLS", async () => {
    m.getAgent.mockResolvedValue({ activeProvider: null });
    m.isProviderConfigured.mockReturnValue(false);
    await post();
    expect(m.rpc).toHaveBeenCalledWith("start_run", expect.anything());
  });
});
