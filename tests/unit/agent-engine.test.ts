import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { priceTokens, hasRate, RATE_CARD_VERSION } from "@/modules/agent-engine/rate-card";
import { MockProvider, MOCK_MODEL_ID } from "@/modules/agent-engine/providers/mock";

describe("rate card", () => {
  it("prices both sides of the call", () => {
    // mock:deterministic is 100 micros/1k in, 300 micros/1k out.
    expect(priceTokens(MOCK_MODEL_ID, { inputTokens: 1000, outputTokens: 1000 })).toBe(400);
  });

  it("rounds UP, so a long tail of tiny calls cannot cost nothing", () => {
    // 1 input token at 100 micros/1k is 0.1 micros. Rounded to nearest it is
    // zero, and a tenant could then spend indefinitely against a cap that
    // never moves. Over-charging by a millionth of a dollar is the cheaper
    // mistake by a wide margin.
    expect(priceTokens(MOCK_MODEL_ID, { inputTokens: 1, outputTokens: 0 })).toBe(1);
    expect(priceTokens(MOCK_MODEL_ID, { inputTokens: 0, outputTokens: 1 })).toBe(1);
  });

  it("returns a whole number of micros, never a float", () => {
    const price = priceTokens("anthropic:sonnet-family", {
      inputTokens: 1234,
      outputTokens: 567,
    });
    expect(price).not.toBeNull();
    expect(Number.isInteger(price)).toBe(true);
  });

  it("refuses a model it cannot price rather than guessing zero", () => {
    expect(priceTokens("not:a:model", { inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(hasRate("not:a:model")).toBe(false);
  });

  it("refuses impossible usage", () => {
    expect(priceTokens(MOCK_MODEL_ID, { inputTokens: -1, outputTokens: 0 })).toBeNull();
    expect(priceTokens(MOCK_MODEL_ID, { inputTokens: 1.5, outputTokens: 0 })).toBeNull();
  });

  it("is versioned, so a price change cannot rewrite last month's bill", () => {
    expect(RATE_CARD_VERSION).toMatch(/^anthropic-list-\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the deterministic provider", () => {
  const provider = new MockProvider();
  const base = {
    model: MOCK_MODEL_ID,
    systemPrompt: "be helpful",
    userInput: "hello",
    maxSteps: 5,
    maxSpendUsdMicros: 1_000_000,
  };

  it("gives the same usage for the same input, every time", async () => {
    const a = await provider.complete(base);
    const b = await provider.complete(base);
    expect(a).toEqual(b);
  });

  it("gives different usage for different input", async () => {
    // A provider that returned one fixed number would let an executor that
    // ignored usage entirely pass every test.
    const a = await provider.complete(base);
    const b = await provider.complete({ ...base, userInput: "something else" });
    expect(a.usage).not.toEqual(b.usage);
  });

  it("says in the output itself that it is not a model answer", async () => {
    const result = await provider.complete(base);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // A plausible paragraph here ends up in a screenshot and then in a
    // conversation about what the product does (CLAUDE.md rule 4).
    expect(result.output).toContain("סימולציה");
    expect(result.output).toContain("No language model was called");
  });

  it("reports usage on a failure that was still billed", async () => {
    const result = await provider.complete({ ...base, userInput: "__FAIL__" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("PROVIDER_UNAVAILABLE");
    expect(result.usage).not.toBeNull();
  });

  it("reports no usage when nothing was sent", async () => {
    const result = await provider.complete({ ...base, userInput: "__REFUSE__" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.usage).toBeNull();
  });

  it("honours an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await provider.complete({ ...base, signal: controller.signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("PROVIDER_CANCELLED");
  });

  it("never reports a cost of its own, so the estimate path is exercised", async () => {
    const result = await provider.complete(base);
    expect(result.reportedCostUsdMicros).toBeNull();
  });
});

describe("provider registry", () => {
  const originalFlag = process.env.AGENTOS_ENABLE_MOCK_PROVIDER;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.AGENTOS_ENABLE_MOCK_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AGENTOS_ENABLE_MOCK_PROVIDER;
    else process.env.AGENTOS_ENABLE_MOCK_PROVIDER = originalFlag;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("offers nothing runnable by default, so production cannot serve simulated answers", async () => {
    const { hasAnyConfiguredProvider, getProvider } =
      await import("@/modules/agent-engine/registry");
    expect(hasAnyConfiguredProvider()).toBe(false);
    expect(getProvider("mock")).toBeNull();
  });

  it("registers Anthropic, but as NOT configured without a server-side key", async () => {
    const { getProvider, isProviderConfigured } = await import("@/modules/agent-engine/registry");
    expect(getProvider("anthropic")).not.toBeNull();
    expect(isProviderConfigured("anthropic")).toBe(false);
  });

  it("offers the mock only when the flag is set", async () => {
    process.env.AGENTOS_ENABLE_MOCK_PROVIDER = "1";
    const { configuredProviderIds, getProvider } = await import("@/modules/agent-engine/registry");
    expect(getProvider("mock")).not.toBeNull();
    expect(configuredProviderIds()).toEqual(["mock"]);
  });
});
