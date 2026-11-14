// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agent Studio: restore an earlier version into the draft, and duplicate an
 * agent. Both run as the signed-in user under RLS; these tests pin down what
 * the routes themselves add on top: which rows they read, which they write,
 * and that nothing outside the caller's organisation is reachable.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const VERSION = "55555555-5555-4555-8555-555555555555";
const NEW_AGENT = "66666666-6666-4666-8666-666666666666";

type Op = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown };

const m = vi.hoisted(() => ({
  ops: [] as Op[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  versionRow: null as { config_json: unknown; published_at: string | null } | null,
  draftRow: { id: "draft-1" } as { id: string } | null,
  source: null as null | {
    name: string;
    description: string | null;
    draftConfig: Record<string, unknown>;
  },
}));

vi.mock("@/modules/api/guard", () => ({
  guardApi: vi.fn(async () => ({
    ok: true,
    context: { orgId: ORG, userId: "u", role: "member" },
    requestId: "33333333-3333-4333-8333-333333333333",
  })),
}));
vi.mock("@/modules/agents/data", () => ({ getAgent: vi.fn(async () => m.source) }));
vi.mock("@/modules/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const op: Op = { table, op: "select", filters: {} };
      m.ops.push(op);
      const chain = {
        select: () => chain,
        update: (payload: unknown) => {
          op.op = "update";
          op.payload = payload;
          return chain;
        },
        eq: (c: string, v: unknown) => {
          op.filters[c] = v;
          return chain;
        },
        is: (c: string, v: unknown) => {
          op.filters[`${c} is`] = v;
          return chain;
        },
        maybeSingle: async () =>
          op.op === "update"
            ? { data: m.draftRow, error: null }
            : { data: m.versionRow, error: null },
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      m.rpcCalls.push({ name, args });
      return { data: NEW_AGENT, error: null };
    },
  }),
}));

function req(path: string, body: unknown) {
  return new Request(`https://agentos.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const STORED = {
  role: "נציג מכירות",
  instructions: "ענה בעברית ובנימוס, והצע פגישה.",
  provider: "mock",
  model: "mock:deterministic",
  maxSteps: 5,
  maxSpendUsdMicros: 500_000,
};

beforeEach(() => {
  m.ops = [];
  m.rpcCalls = [];
  m.versionRow = { config_json: STORED, published_at: "2026-11-01T00:00:00Z" };
  m.draftRow = { id: "draft-1" };
  m.source = { name: "MARKET", description: "סוכן שיווק", draftConfig: STORED };
});

describe("POST /api/agents/:id/restore", () => {
  async function restore() {
    const { POST } = await import("@/app/api/agents/[id]/restore/route");
    return POST(
      req(`/api/agents/${AGENT}/restore`, { orgId: ORG, versionId: VERSION }) as never,
      { params: Promise.resolve({ id: AGENT }) } as never,
    );
  }

  it("copies the published version's config into the draft - and only the draft", async () => {
    const res = await restore();
    expect(res.status).toBe(200);
    const read = m.ops.find((o) => o.op === "select");
    expect(read?.filters).toMatchObject({ org_id: ORG, agent_id: AGENT, id: VERSION });
    const write = m.ops.find((o) => o.op === "update");
    expect(write?.filters).toMatchObject({
      org_id: ORG,
      agent_id: AGENT,
      "published_at is": null,
    });
    expect(write?.payload).toMatchObject({ config_json: expect.objectContaining(STORED) });
  });

  it("refuses a version it cannot see - another organisation's - and writes nothing", async () => {
    m.versionRow = null; // RLS returns no row
    const res = await restore();
    expect(res.status).toBe(403);
    expect(m.ops.some((o) => o.op === "update")).toBe(false);
  });

  it("refuses to 'restore' an unpublished version", async () => {
    m.versionRow = { config_json: STORED, published_at: null };
    const res = await restore();
    expect(res.status).toBe(403);
    expect(m.ops.some((o) => o.op === "update")).toBe(false);
  });
});

describe("POST /api/agents/:id/duplicate", () => {
  async function duplicate() {
    const { POST } = await import("@/app/api/agents/[id]/duplicate/route");
    return POST(
      req(`/api/agents/${AGENT}/duplicate`, { orgId: ORG }) as never,
      { params: Promise.resolve({ id: AGENT }) } as never,
    );
  }

  it("creates the copy in the caller's organisation and copies the draft into it", async () => {
    const res = await duplicate();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: NEW_AGENT });
    expect(m.rpcCalls[0]).toMatchObject({
      name: "create_agent",
      args: { p_org_id: ORG, p_name: "עותק של MARKET" },
    });
    const write = m.ops.find((o) => o.op === "update");
    expect(write?.filters).toMatchObject({ org_id: ORG, agent_id: NEW_AGENT });
    expect(write?.payload).toEqual({ config_json: STORED });
  });

  it("cannot copy an agent from another organisation (not found under RLS)", async () => {
    m.source = null;
    const res = await duplicate();
    expect(res.status).toBe(403);
    expect(m.rpcCalls).toHaveLength(0);
  });

  it("never publishes the copy", async () => {
    await duplicate();
    expect(m.rpcCalls.map((c) => c.name)).not.toContain("publish_agent_version");
  });
});

describe("business goals", () => {
  it("are optional in a draft and reach the model when set", async () => {
    const { AgentDraftConfigSchema } = await import("@/modules/contracts");
    expect(AgentDraftConfigSchema.parse({}).goals).toBe("");
    const { buildSystemPrompt } = await import("@/modules/runtime/executor");
    expect(buildSystemPrompt("r", "instructions here", "")).not.toContain("Business goals");
    expect(buildSystemPrompt("r", "instructions here", "לקבוע פגישות")).toContain("לקבוע פגישות");
  });
});
