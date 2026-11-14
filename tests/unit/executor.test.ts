import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The executor's contract, tested without a database.
 *
 * One property matters more than the rest: **a dispatched run always settles.**
 * A path that returns without calling settle_run leaves the reservation held
 * until the sweeper finds it an hour later, and the tenant's spend cap smaller
 * until then. Every test below therefore asserts how many times settle_run was
 * called as well as with what.
 *
 * The Supabase client is faked rather than mocked per-method, so the executor
 * runs its real control flow and only the I/O is substituted.
 */

type Call = { table: string; op: string; payload?: unknown };

function fakeDb(options: { run?: Record<string, unknown> | null; config?: unknown }) {
  const calls: Call[] = [];
  const rpc: Array<{ name: string; args: Record<string, unknown> }> = [];

  const builder = (table: string) => {
    const state: { op: string; payload?: unknown } = { op: "select" };
    const result = () => {
      if (table === "runs" && state.op === "select") {
        return { data: options.run ?? null, error: null };
      }
      if (table === "agent_versions" && state.op === "select") {
        return { data: { config_json: options.config }, error: null };
      }
      if (table === "run_steps" && state.op === "insert") {
        return { data: { id: "step-1" }, error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => result(),
      single: async () => result(),
      insert: (payload: unknown) => {
        state.op = "insert";
        calls.push({ table, op: "insert", payload });
        return chain;
      },
      update: (payload: unknown) => {
        state.op = "update";
        calls.push({ table, op: "update", payload });
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  };

  return {
    calls,
    rpc,
    client: {
      from: (table: string) => builder(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpc.push({ name, args });
        return { data: null, error: null };
      },
    },
  };
}

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  isServiceRoleConfigured: vi.fn(() => true),
}));

vi.mock("@/modules/service-role/client", () => mocks);

const VALID_CONFIG = {
  name: "Support",
  role: "נציג תמיכה",
  instructions: "ענה בעברית, בקצרה, ואל תמציא מדיניות.",
  provider: "mock",
  model: "mock:deterministic",
  tools: [],
  knowledgeBaseIds: [],
  maxSteps: 5,
  maxSpendUsdMicros: 2_000_000,
};

const QUEUED_RUN = {
  id: "run-1",
  org_id: "org-1",
  status: "queued",
  agent_version_id: "ver-1",
  input_json: { prompt: "hello" },
  budget_usd_micros: 2_000_000,
};

const originalFlag = process.env.AGENTOS_ENABLE_MOCK_PROVIDER;

beforeEach(() => {
  process.env.AGENTOS_ENABLE_MOCK_PROVIDER = "1";
  mocks.isServiceRoleConfigured.mockReturnValue(true);
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.AGENTOS_ENABLE_MOCK_PROVIDER;
  else process.env.AGENTOS_ENABLE_MOCK_PROVIDER = originalFlag;
});

async function run(options: Parameters<typeof fakeDb>[0]) {
  const db = fakeDb(options);
  mocks.createServiceRoleClient.mockReturnValue(db.client);
  const { executeRun } = await import("@/modules/runtime/executor");
  const outcome = await executeRun("run-1");
  const settles = db.rpc.filter((r) => r.name === "settle_run");
  return { outcome, db, settles };
}

describe("executeRun", () => {
  it("settles exactly once on success, with a non-zero cost", async () => {
    const { outcome, settles } = await run({ run: QUEUED_RUN, config: VALID_CONFIG });
    expect(outcome.ok).toBe(true);
    expect(settles).toHaveLength(1);
    expect(settles[0]?.args.p_status).toBe("succeeded");
    expect(Number(settles[0]?.args.p_cost_usd_micros)).toBeGreaterThan(0);
  });

  it("records usage as an estimate when the provider reports no cost", async () => {
    const { db } = await run({ run: QUEUED_RUN, config: VALID_CONFIG });
    const usage = db.calls.find((c) => c.table === "usage_events" && c.op === "insert");
    expect(usage).toBeDefined();
    const payload = usage?.payload as Record<string, unknown>;
    // Presenting our own arithmetic as the provider's figure would be a
    // fabricated number on a bill.
    expect(payload.estimate_source).toBe("estimated");
    expect(payload.rate_card_version).toBeTruthy();
  });

  it("writes no prompt or completion text to the trace", async () => {
    const { db } = await run({ run: QUEUED_RUN, config: VALID_CONFIG });
    const written = JSON.stringify(db.calls);
    expect(written).not.toContain("hello"); // the prompt
    expect(written).not.toContain("No language model was called"); // the output
    const step = db.calls.find((c) => c.table === "run_steps" && c.op === "update");
    const summary = (step?.payload as { summary_json?: Record<string, unknown> })?.summary_json;
    expect(summary).toHaveProperty("outputChars");
  });

  it("settles and still charges when the provider failed after being billed", async () => {
    const { outcome, settles, db } = await run({
      run: { ...QUEUED_RUN, input_json: { prompt: "__FAIL__" } },
      config: VALID_CONFIG,
    });
    expect(outcome.ok).toBe(false);
    expect(settles).toHaveLength(1);
    expect(settles[0]?.args.p_status).toBe("failed");
    expect(settles[0]?.args.p_error_code).toBe("PROVIDER_UNAVAILABLE");
    // The call was billed. A run that failed free of charge would be a lie.
    expect(Number(settles[0]?.args.p_cost_usd_micros)).toBeGreaterThan(0);
    expect(db.calls.some((c) => c.table === "usage_events")).toBe(true);
  });

  it("settles at zero when nothing was sent", async () => {
    const { settles, db } = await run({
      run: { ...QUEUED_RUN, input_json: { prompt: "__REFUSE__" } },
      config: VALID_CONFIG,
    });
    expect(settles).toHaveLength(1);
    expect(Number(settles[0]?.args.p_cost_usd_micros)).toBe(0);
    expect(db.calls.some((c) => c.table === "usage_events")).toBe(false);
  });

  it("settles when the published config no longer parses", async () => {
    const { outcome, settles } = await run({ run: QUEUED_RUN, config: { broken: true } });
    expect(outcome.ok).toBe(false);
    expect(settles).toHaveLength(1);
    expect(settles[0]?.args.p_error_code).toBe("AGENT_CONFIG_INVALID");
  });

  it("settles when the configured provider is not registered", async () => {
    delete process.env.AGENTOS_ENABLE_MOCK_PROVIDER;
    const { outcome, settles } = await run({ run: QUEUED_RUN, config: VALID_CONFIG });
    expect(outcome.ok).toBe(false);
    expect(settles).toHaveLength(1);
    expect(settles[0]?.args.p_error_code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("does NOT settle a run that is no longer queued", async () => {
    // cancel_run already released the reservation. Settling again would credit
    // the period a second time and quietly inflate the tenant's headroom.
    const { outcome, settles } = await run({
      run: { ...QUEUED_RUN, status: "cancelled" },
      config: VALID_CONFIG,
    });
    expect(outcome.ok).toBe(false);
    expect(settles).toHaveLength(0);
  });

  it("does not settle a run it cannot find", async () => {
    const { outcome, settles } = await run({ run: null, config: VALID_CONFIG });
    expect(outcome.ok).toBe(false);
    expect(settles).toHaveLength(0);
  });

  it("returns without throwing when the service role is unavailable", async () => {
    mocks.isServiceRoleConfigured.mockReturnValue(false);
    const { executeRun } = await import("@/modules/runtime/executor");
    const outcome = await executeRun("run-1");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.code).toBe("RUNTIME_NOT_CONFIGURED");
  });

  it("settles even when our own code throws mid-run", async () => {
    const db = fakeDb({ run: QUEUED_RUN, config: VALID_CONFIG });
    const rpcCalls: Array<{ name: string }> = [];
    mocks.createServiceRoleClient.mockReturnValue({
      from: (table: string) => {
        if (table === "run_steps") throw new Error("boom");
        return db.client.from(table);
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name });
        db.rpc.push({ name, args });
        return { data: null, error: null };
      },
    });
    const { executeRun } = await import("@/modules/runtime/executor");
    const outcome = await executeRun("run-1");

    expect(outcome.ok).toBe(false);
    // This is the property the whole file exists for: the reservation is
    // released even when the failure is ours and unexpected.
    expect(rpcCalls.filter((r) => r.name === "settle_run")).toHaveLength(1);
    expect(db.rpc.at(-1)?.args.p_error_code).toBe("RUNTIME_ERROR");
  });
});
