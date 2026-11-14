// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextServer from "next/server";

/** POST /api/agents/:id/test-run - checks that happen BEFORE anything is reserved. */

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

const GOOD = {
  role: "נציג",
  instructions: "ענה בעברית ובקצרה.",
  goals: "",
  provider: "mock",
  model: "mock:deterministic",
  tools: [],
  knowledgeBaseIds: [],
  maxSteps: 5,
  maxSpendUsdMicros: 400_000,
};

const m = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { run_id: "run-t" }, error: null })),
  agent: null as null | { name: string; draftConfig: Record<string, unknown> },
  providerOk: true,
  runtimeOk: true,
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
vi.mock("@/modules/agents/data", () => ({ getAgent: vi.fn(async () => m.agent) }));
vi.mock("@/modules/agent-engine/registry", () => ({
  isProviderConfigured: () => m.providerOk,
}));
vi.mock("@/modules/runtime/readiness", () => ({ isRuntimeConfigured: () => m.runtimeOk }));
vi.mock("@/modules/runtime/recovery", () => ({ recoverStaleRuns: async () => ({ recovered: 0 }) }));
vi.mock("@/modules/runtime/executor", () => ({ executeRun: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  after: vi.fn(),
}));

async function post() {
  const { POST } = await import("@/app/api/agents/[id]/test-run/route");
  const request = new Request(`https://agentos.test/api/agents/${AGENT}/test-run`, {
    method: "POST",
    body: JSON.stringify({ orgId: ORG, prompt: "שלום" }),
    headers: { "content-type": "application/json" },
  });
  return POST(request as never, { params: Promise.resolve({ id: AGENT }) } as never);
}

beforeEach(() => {
  m.rpc.mockClear();
  m.agent = { name: "MARKET", draftConfig: GOOD };
  m.providerOk = true;
  m.runtimeOk = true;
});

describe("POST /api/agents/:id/test-run", () => {
  it("dispatches a valid saved draft through start_test_run", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("start_test_run", {
      p_agent_id: AGENT,
      p_input: { prompt: "שלום" },
    });
  });

  it("names the missing fields of an incomplete draft and reserves nothing", async () => {
    m.agent = { name: "MARKET", draftConfig: { ...GOOD, instructions: "", provider: "" } };
    const res = await post();
    const body = await res.json();
    expect(body.code).toBe("AGENT_CONFIG_INVALID");
    expect(body.message).toContain("instructions");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses a provider this deployment cannot call, before reserving", async () => {
    m.providerOk = false;
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses without a runtime, before reserving", async () => {
    m.runtimeOk = false;
    expect((await post()).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("answers as not found for an agent outside the caller's organisation", async () => {
    m.agent = null;
    expect((await post()).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
