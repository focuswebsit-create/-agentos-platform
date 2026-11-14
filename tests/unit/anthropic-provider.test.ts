// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import {
  AnthropicProvider,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  affordableOutputTokens,
  promptTokenUpperBound,
  type CreateMessage,
} from "@/modules/agent-engine/providers/anthropic";
import { priceTokens, worstCaseCost, UNKNOWN_CLAUDE_RATE } from "@/modules/agent-engine/rate-card";

/**
 * The Anthropic provider against a FAKE SDK call.
 *
 * Every test here is a mock test: no key, no network, no model. They prove the
 * provider builds the request it should, keeps a run inside its budget, prices
 * what comes back, and maps every failure. Whether Anthropic's API accepts the
 * request is a separate question that only a live call answers; see
 * `docs/DEPLOYMENT.md` for how that is verified, and the implementation log for
 * whether it has been.
 */

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function message(overrides: Partial<Record<string, unknown>> = {}): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "שלום! איך אפשר לעזור?" },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      iterations: null,
    },
    ...overrides,
  } as unknown as BetaMessage;
}

function headers() {
  return new Headers();
}

const base = {
  model: "claude-sonnet-5-5",
  systemPrompt: "Your role: נציג תמיכה\n\nענה בעברית ובקצרה.",
  userInput: "מה שעות הפעילות?",
  maxSteps: 5,
  maxSpendUsdMicros: 2_000_000,
};

function provider(create: CreateMessage, configured = true) {
  return new AnthropicProvider({ create, configured: () => configured, sleep: async () => {} });
}

describe("the request it sends", () => {
  it("sends the real model id, the system prompt and the user turn - and nothing else", async () => {
    const create = vi.fn<CreateMessage>(async () => message());
    await provider(create).complete(base);

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]?.[0] as Params;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.system).toBe(base.systemPrompt);
    expect(params.messages).toEqual([{ role: "user", content: base.userInput }]);
    // Parameters these models reject with a 400.
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params).not.toHaveProperty("top_k");
    expect(params).not.toHaveProperty("thinking");
    expect(params.output_config).toEqual({ effort: "medium" });
  });

  it("enables the server-side fallback for Sonnet 5.5 and Opus 5.5", async () => {
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
      const create = vi.fn<CreateMessage>(async () => message({ model }));
      await provider(create).complete({ ...base, model });
      const params = create.mock.calls[0]?.[0] as Params;
      expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
      expect(params.fallbacks).toBe("default");
    }
  });

  it("does NOT send fallbacks to Haiku 5.5, which rejects them", async () => {
    const create = vi.fn<CreateMessage>(async () => message({ model: "claude-haiku-5-5" }));
    await provider(create).complete({ ...base, model: "claude-haiku-5-5" });
    const params = create.mock.calls[0]?.[0] as Params;
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
  });

  it("runs an agent published with a legacy picker key on the current model", async () => {
    const create = vi.fn<CreateMessage>(async () => message());
    const result = await provider(create).complete({ ...base, model: "anthropic:sonnet-family" });
    expect(result.ok).toBe(true);
    expect((create.mock.calls[0]?.[0] as Params).model).toBe("claude-sonnet-5-5");
  });

  it("refuses a model it does not offer, before sending anything", async () => {
    const create = vi.fn<CreateMessage>(async () => message());
    const result = await provider(create).complete({ ...base, model: "claude-unknown-9" });
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_BAD_REQUEST", usage: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("passes the abort signal through", async () => {
    const controller = new AbortController();
    const create = vi.fn<CreateMessage>(async () => message());
    await provider(create).complete({ ...base, signal: controller.signal });
    expect(create.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });
});

describe("budget - the worst case fits before anything is sent", () => {
  it("never asks for more output than the budget can pay for, fallback included", async () => {
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]) {
      for (const budget of [50_000, 200_000, 1_000_000, 100_000_000]) {
        const create = vi.fn<CreateMessage>(async () => message({ model }));
        const result = await provider(create).complete({
          ...base,
          model,
          maxSpendUsdMicros: budget,
        });
        if (create.mock.calls.length === 0) {
          expect(result).toMatchObject({ ok: false, code: "BUDGET_TOO_LOW", usage: null });
          continue;
        }
        const maxTokens = (create.mock.calls[0]?.[0] as Params).max_tokens;
        const prompt = promptTokenUpperBound(base.systemPrompt, base.userInput);
        let worst = worstCaseCost(model, prompt, maxTokens) ?? Infinity;
        if (model !== "claude-haiku-5-5") {
          // Declined first attempt AND a fallback attempt at the ceiling rate.
          worst +=
            Math.ceil((prompt * UNKNOWN_CLAUDE_RATE.inputMicrosPer1k) / 1000) +
            Math.ceil((maxTokens * UNKNOWN_CLAUDE_RATE.outputMicrosPer1k) / 1000);
        }
        expect(worst, `${model} @ ${budget}`).toBeLessThanOrEqual(budget);
        expect(maxTokens).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
        expect(maxTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
      }
    }
  });

  it("refuses with BUDGET_TOO_LOW, at no cost, when not even a minimal answer fits", async () => {
    const create = vi.fn<CreateMessage>(async () => message());
    const result = await provider(create).complete({ ...base, maxSpendUsdMicros: 1_000 });
    expect(result).toMatchObject({ ok: false, code: "BUDGET_TOO_LOW", usage: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("counts the prompt as at least its UTF-8 byte length - Hebrew is two bytes a letter", () => {
    expect(promptTokenUpperBound("שלום", "")).toBe(8 + 64);
  });

  it("caps output at MAX_OUTPUT_TOKENS even with a large budget", () => {
    expect(affordableOutputTokens("claude-haiku-5-5", 1000, 100_000_000)).toBe(MAX_OUTPUT_TOKENS);
  });
});

describe("what it reports back", () => {
  it("returns only the text blocks, never thinking", async () => {
    const result = await provider(async () => message()).complete(base);
    expect(result).toMatchObject({ ok: true, output: "שלום! איך אפשר לעזור?" });
  });

  it("prices usage at the model's own rate, as an estimate", async () => {
    const result = await provider(async () => message()).complete(base);
    expect(result.reportedCostUsdMicros).toBeNull();
    expect(result.estimatedCostUsdMicros).toBe(
      priceTokens("claude-sonnet-5-5", { inputTokens: 120, outputTokens: 80 }),
    );
    expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 80 });
  });

  it("prices each attempt of a fallback at the rate of the model that ran it", async () => {
    const result = await provider(async () =>
      message({
        model: "claude-opus-4-8",
        content: [
          {
            type: "fallback",
            from: { model: "claude-sonnet-5-5" },
            to: { model: "claude-opus-4-8" },
          },
          { type: "text", text: "answer" },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 40,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          iterations: [
            {
              type: "message",
              model: "claude-sonnet-5-5",
              input_tokens: 100,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            {
              type: "fallback_message",
              model: "claude-opus-4-8",
              input_tokens: 100,
              output_tokens: 40,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          ],
        },
      }),
    ).complete(base);

    expect(result.ok).toBe(true);
    const expected =
      (priceTokens("claude-sonnet-5-5", { inputTokens: 100, outputTokens: 0 }) ?? 0) +
      (priceTokens("claude-opus-4-8", { inputTokens: 100, outputTokens: 40 }) ?? 0);
    expect(result.estimatedCostUsdMicros).toBe(expected);
    expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 40 });
    if (result.ok) expect(result.servedModel).toBe("claude-opus-4-8");
  });

  it("prices an unlisted Claude model at the ceiling, never at zero", () => {
    expect(priceTokens("claude-future-9", { inputTokens: 1000, outputTokens: 1000 })).toBe(
      UNKNOWN_CLAUDE_RATE.inputMicrosPer1k + UNKNOWN_CLAUDE_RATE.outputMicrosPer1k,
    );
  });

  it("treats a refusal as a billed failure and discards any partial output", async () => {
    const result = await provider(async () =>
      message({ stop_reason: "refusal", content: [{ type: "text", text: "partial" }] }),
    ).complete(base);
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_REFUSED" });
    expect(result.usage).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain("partial");
  });

  it("flags an answer cut off at the output cap", async () => {
    const result = await provider(async () => message({ stop_reason: "max_tokens" })).complete(
      base,
    );
    expect(result).toMatchObject({ ok: true, truncated: true });
  });

  it("fails, billed, when the cap was spent before any answer text", async () => {
    const result = await provider(async () =>
      message({
        stop_reason: "max_tokens",
        content: [{ type: "thinking", thinking: "", signature: "s" }],
      }),
    ).complete(base);
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_OUTPUT_LIMIT" });
    expect(result.usage).not.toBeNull();
  });
});

describe("failures - mapped, never thrown, never leaking the provider's message", () => {
  const cases: Array<[string, () => Error, string]> = [
    [
      "401",
      () =>
        new AuthenticationError(
          401,
          { error: { message: "secret detail" } },
          "secret detail",
          headers(),
        ),
      "PROVIDER_AUTH",
    ],
    [
      "400",
      () =>
        new BadRequestError(
          400,
          { error: { message: "secret detail" } },
          "secret detail",
          headers(),
        ),
      "PROVIDER_BAD_REQUEST",
    ],
    ["timeout", () => new APIConnectionTimeoutError(), "PROVIDER_TIMEOUT"],
    ["abort", () => new APIUserAbortError(), "PROVIDER_CANCELLED"],
    ["other", () => new Error("boom"), "PROVIDER_UNAVAILABLE"],
  ];

  for (const [label, make, code] of cases) {
    it(`${label} -> ${code}, with no usage and no raw message`, async () => {
      const result = await provider(async () => {
        throw make();
      }).complete(base);
      expect(result).toMatchObject({ ok: false, code, usage: null });
      expect(JSON.stringify(result)).not.toContain("secret detail");
    });
  }

  it("retries once on 429, which the API did not bill", async () => {
    let calls = 0;
    const result = await provider(async () => {
      calls++;
      if (calls === 1) throw new RateLimitError(429, undefined, "rate limited", headers());
      return message();
    }).complete(base);
    expect(calls).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("retries once on 500, and reports the second failure", async () => {
    let calls = 0;
    const result = await provider(async () => {
      calls++;
      throw new InternalServerError(500, undefined, "boom", headers());
    }).complete(base);
    expect(calls).toBe(2);
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_UNAVAILABLE" });
  });

  it("does NOT retry a timeout - the first attempt may already have been billed", async () => {
    let calls = 0;
    await provider(async () => {
      calls++;
      throw new APIConnectionTimeoutError();
    }).complete(base);
    expect(calls).toBe(1);
  });

  it("does not send anything when not configured", async () => {
    const create = vi.fn<CreateMessage>(async () => message());
    const p = new AnthropicProvider({ configured: () => false });
    const result = await p.complete(base);
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_AUTH", usage: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("honours an already-aborted signal without sending", async () => {
    const controller = new AbortController();
    controller.abort();
    const create = vi.fn<CreateMessage>(async () => message());
    const result = await provider(create).complete({ ...base, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_CANCELLED" });
    expect(create).not.toHaveBeenCalled();
  });
});
