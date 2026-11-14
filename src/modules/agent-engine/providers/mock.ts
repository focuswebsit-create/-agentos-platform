import { createHash } from "node:crypto";
import type { ModelProvider, ProviderRequest, ProviderResult } from "../provider";

/**
 * A deterministic provider.
 *
 * `ROADMAP.md`'s P3 gate asks for "actual provider runs AND deterministic
 * mocked unit tests". This is the second half, and it is part of the plan
 * rather than a stand-in for the first: a test suite that needs a network call
 * and a credit card is a suite nobody runs.
 *
 * Deterministic means the same input produces the same output, the same token
 * counts and therefore the same cost, every time and on every machine. The
 * counts come from a SHA-256 of the request, so they are stable but not
 * uniform — a test that only ever saw the same number would not notice an
 * executor that ignored usage entirely.
 *
 * WHAT THIS IS NOT:
 *
 * It does not call a model and its output is not an answer. Every reply says
 * so, in the output text itself, because a plausible-looking paragraph here
 * would end up in a screenshot and then in a conversation about what the
 * product does. `CLAUDE.md` rule 4 forbids production dummy results; this is
 * built so that it cannot be mistaken for one even out of context.
 *
 * `isConfigured()` is true: the mock genuinely is ready to run. What stops it
 * reaching production is that the registry only offers it when
 * `AGENTOS_ENABLE_MOCK_PROVIDER` is set, which no production environment sets.
 */

export const MOCK_MODEL_ID = "mock:deterministic";

const MOCK_OUTPUT_PREFIX =
  "[סימולציה — לא תשובת מודל] This text was generated locally by AgentOS's deterministic " +
  "test provider. No language model was called and nothing here is an answer. ";

function stableCounts(seed: string): { inputTokens: number; outputTokens: number } {
  const digest = createHash("sha256").update(seed).digest();
  // Bounded and non-trivial: 40-551 in, 20-275 out. Wide enough that a cost
  // calculation which dropped one of the two terms would show up.
  return {
    inputTokens: 40 + (((digest[0] ?? 0) << 1) | ((digest[1] ?? 0) & 1)),
    outputTokens: 20 + (digest[2] ?? 0),
  };
}

export class MockProvider implements ModelProvider {
  readonly id = "mock";

  isConfigured(): boolean {
    return true;
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    if (request.signal?.aborted) {
      return { ok: false, code: "PROVIDER_CANCELLED", usage: null, reportedCostUsdMicros: null };
    }

    const seed = `${request.model}\u0000${request.systemPrompt}\u0000${request.userInput}`;
    const usage = stableCounts(seed);

    // Two reserved inputs, so the failure paths have deterministic coverage
    // without a test having to stub the provider and thereby stop testing it.
    const trimmed = request.userInput.trim();
    if (trimmed === "__FAIL__") {
      // Usage is reported: the call was billed and then failed, which is the
      // case an executor that only settles on success gets wrong.
      return { ok: false, code: "PROVIDER_UNAVAILABLE", usage, reportedCostUsdMicros: null };
    }
    if (trimmed === "__REFUSE__") {
      return { ok: false, code: "PROVIDER_REFUSED", usage: null, reportedCostUsdMicros: null };
    }

    return {
      ok: true,
      output:
        MOCK_OUTPUT_PREFIX +
        `Request digest: ${createHash("sha256").update(seed).digest("hex").slice(0, 16)}.`,
      usage,
      // Null on purpose: the mock does not report cost, so the rate card prices
      // it and the event is recorded as `estimated`. That exercises the
      // estimate path, which is the one a real provider without cost reporting
      // will also take.
      reportedCostUsdMicros: null,
    };
  }
}
