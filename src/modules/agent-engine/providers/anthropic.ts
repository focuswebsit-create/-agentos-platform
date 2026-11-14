import "server-only";
import Anthropic, {
  APIError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { getAnthropicApiKey, hasAnthropicApiKey } from "@/config/provider-keys.server";
import type {
  ModelProvider,
  ProviderFailureCode,
  ProviderRequest,
  ProviderResult,
} from "../provider";
import {
  outputRatePer1k,
  priceTokens,
  resolveModelId,
  UNKNOWN_CLAUDE_RATE,
  type TokenUsage,
} from "../rate-card";

/**
 * Anthropic's Claude, through the official SDK (`@anthropic-ai/sdk`, pinned).
 *
 * WHAT A RUN SENDS
 *
 * One Messages API request: the agent's role and instructions as `system`, the
 * user's input as the single user turn. No tools, no prior conversation, no
 * prompt caching. Nothing else reaches the model — not the organisation id, not
 * the user's identity, never a key.
 *
 * MONEY
 *
 * Three properties, because a spend cap that a request can overrun is not a cap:
 *
 *  1. **The worst case fits the budget before anything is sent.** `max_tokens`
 *     is derived from the run's remaining budget, assuming the prompt costs its
 *     UTF-8 byte length in tokens (an upper bound - no tokenizer produces more
 *     tokens than bytes) and, where a server-side fallback is enabled, that a
 *     declined first attempt and a fallback attempt are BOTH billed in full,
 *     the second at the highest Claude price known. If even a minimal answer
 *     does not fit, the request is refused with `BUDGET_TOO_LOW` and costs
 *     nothing.
 *  2. **Every attempt is priced at its own model's rate.** With a fallback, a
 *     response can be produced by a different model than the one requested;
 *     `usage.iterations` lists each attempt and the model that ran it.
 *  3. **Usage is reported on refusal and on truncation**, because both were
 *     billed.
 *
 * RETRIES
 *
 * The SDK's own retries are off. It would retry a timeout, and a request that
 * timed out on our side may well have finished - and been billed - on theirs.
 * This retries once, and only on answers where the API has said it did NOT do
 * the work: 429, 500, 503 and 529. Those are not billed, so retrying them is safe.
 *
 * SERVER-SIDE FALLBACK
 *
 * Enabled (`fallbacks: "default"`) for Claude Opus 5.5 and Claude Sonnet 5.5.
 * When a safety classifier declines a request, Anthropic re-runs it on its
 * recommended fallback model instead of returning the refusal. Claude Haiku 5.5
 * does not support it, so it is not sent there.
 */

/** Models offered in Agent Studio. Anything else is refused before sending. */
export const ANTHROPIC_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

const FALLBACK_MODELS = new Set<string>(["claude-opus-5-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Upper bound on output per request; also bounds latency for a non-streaming call. */
export const MAX_OUTPUT_TOKENS = 8_000;
/**
 * The least worth sending. These models always think before answering, and
 * thinking counts against `max_tokens`; below this, the answer would usually
 * be cut off before it began.
 */
export const MIN_OUTPUT_TOKENS = 512;

/** Per-attempt timeout, milliseconds. */
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_STATUSES = new Set([429, 500, 503, 529]);

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** The one SDK call this provider makes. Injectable, so tests never need a key or a network. */
export type CreateMessage = (
  params: CreateParams,
  options: { signal?: AbortSignal },
) => Promise<BetaMessage>;

function defaultCreate(): CreateMessage | null {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
  return (params, options) => client.beta.messages.create(params, options);
}

/** An upper bound on prompt tokens: UTF-8 bytes, plus room for message framing. */
export function promptTokenUpperBound(system: string, user: string): number {
  return Buffer.byteLength(system, "utf8") + Buffer.byteLength(user, "utf8") + 64;
}

/**
 * The largest `max_tokens` whose worst case still fits `budgetMicros`, or null
 * if not even MIN_OUTPUT_TOKENS fits. Exported for tests.
 */
export function affordableOutputTokens(
  model: string,
  promptTokens: number,
  budgetMicros: number,
): number | null {
  const primaryOut = outputRatePer1k(model, promptTokens);
  const primaryIn = priceTokens(model, { inputTokens: promptTokens, outputTokens: 0 });
  if (primaryOut === null || primaryIn === null) return null;

  let fixed = primaryIn;
  let perOutput1k = primaryOut;
  if (FALLBACK_MODELS.has(model)) {
    // Worst case: the first attempt is billed in full AND the fallback attempt
    // runs on the most expensive Claude model this card knows.
    fixed += Math.ceil((promptTokens * UNKNOWN_CLAUDE_RATE.inputMicrosPer1k) / 1000);
    perOutput1k += UNKNOWN_CLAUDE_RATE.outputMicrosPer1k;
  }

  // +1 per side absorbs priceTokens' per-side round-up.
  const remaining = budgetMicros - fixed - 2;
  if (remaining <= 0) return null;
  const tokens = Math.min(MAX_OUTPUT_TOKENS, Math.floor((remaining * 1000) / perOutput1k));
  return tokens >= MIN_OUTPUT_TOKENS ? tokens : null;
}

type Attempt = { model: string; usage: TokenUsage };

/** Each billed attempt and the model that ran it. Falls back to top-level usage. */
function attemptsOf(message: BetaMessage, requested: string): Attempt[] {
  const iterations = message.usage.iterations ?? [];
  const fromIterations: Attempt[] = [];
  for (const entry of iterations) {
    const e = entry as {
      model?: string | null;
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };
    if (typeof e.input_tokens !== "number" || typeof e.output_tokens !== "number") continue;
    fromIterations.push({
      model: e.model ?? message.model ?? requested,
      usage: {
        inputTokens: e.input_tokens,
        outputTokens: e.output_tokens,
        cacheReadInputTokens: e.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: e.cache_creation_input_tokens ?? 0,
      },
    });
  }
  if (fromIterations.length > 0) return fromIterations;

  return [
    {
      model: message.model ?? requested,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    },
  ];
}

function sum(attempts: Attempt[]): TokenUsage {
  return attempts.reduce<TokenUsage>(
    (acc, a) => ({
      inputTokens: acc.inputTokens + a.usage.inputTokens,
      outputTokens: acc.outputTokens + a.usage.outputTokens,
      cacheReadInputTokens: (acc.cacheReadInputTokens ?? 0) + (a.usage.cacheReadInputTokens ?? 0),
      cacheCreationInputTokens:
        (acc.cacheCreationInputTokens ?? 0) + (a.usage.cacheCreationInputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  );
}

function cost(attempts: Attempt[]): number {
  // priceTokens prices any claude-* id, at the ceiling if unlisted, so this
  // only returns 0 for a non-Claude model, which this provider never sends.
  return attempts.reduce((acc, a) => acc + (priceTokens(a.model, a.usage) ?? 0), 0);
}

function classify(error: unknown): ProviderFailureCode {
  if (error instanceof APIUserAbortError) return "PROVIDER_CANCELLED";
  if (error instanceof APIConnectionTimeoutError) return "PROVIDER_TIMEOUT";
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return "PROVIDER_AUTH";
  }
  if (error instanceof BadRequestError) return "PROVIDER_BAD_REQUEST";
  if (error instanceof RateLimitError) return "PROVIDER_RATE_LIMITED";
  if (error instanceof APIError && error.status === 422) return "PROVIDER_BAD_REQUEST";
  return "PROVIDER_UNAVAILABLE";
}

function retryable(error: unknown): boolean {
  return error instanceof APIError && typeof error.status === "number"
    ? RETRY_STATUSES.has(error.status)
    : false;
}

export type AnthropicProviderOptions = {
  /** Replaces the SDK call. Tests only. */
  create?: CreateMessage;
  /** Replaces the key check. Tests only. */
  configured?: () => boolean;
  /** Replaces the backoff wait. Tests only. */
  sleep?: (ms: number) => Promise<void>;
};

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  private readonly options: AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions = {}) {
    this.options = options;
  }

  isConfigured(): boolean {
    return this.options.configured ? this.options.configured() : hasAnthropicApiKey();
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const nothingSent = (code: ProviderFailureCode): ProviderResult => ({
      ok: false,
      code,
      usage: null,
      reportedCostUsdMicros: null,
    });

    if (request.signal?.aborted) return nothingSent("PROVIDER_CANCELLED");

    const model = resolveModelId(request.model);
    if (!(ANTHROPIC_MODELS as readonly string[]).includes(model)) {
      return nothingSent("PROVIDER_BAD_REQUEST");
    }

    const create = this.options.create ?? (this.isConfigured() ? defaultCreate() : null);
    if (!create) return nothingSent("PROVIDER_AUTH");

    const promptTokens = promptTokenUpperBound(request.systemPrompt, request.userInput);
    const maxTokens = affordableOutputTokens(model, promptTokens, request.maxSpendUsdMicros);
    if (maxTokens === null) return nothingSent("BUDGET_TOO_LOW");

    const params: CreateParams = {
      model,
      max_tokens: maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userInput }],
      output_config: { effort: "medium" },
      ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
    };

    const sleep = this.options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    let message: BetaMessage | null = null;
    for (let attempt = 0; attempt < 2 && message === null; attempt++) {
      try {
        message = await create(params, { signal: request.signal });
      } catch (error) {
        if (attempt === 0 && retryable(error) && !request.signal?.aborted) {
          await sleep(1_000);
          continue;
        }
        // Thrown errors carry no usage. For every class mapped here except a
        // timeout, the API did not do the work; for a timeout it may have, and
        // there is no way to know - the reservation is settled at zero and the
        // shortfall, if any, is bounded by the budget that was reserved.
        return nothingSent(classify(error));
      }
    }
    if (message === null) return nothingSent("PROVIDER_UNAVAILABLE");

    const attempts = attemptsOf(message, model);
    const usage = sum(attempts);
    const estimated = cost(attempts);
    const billed = { usage, reportedCostUsdMicros: null, estimatedCostUsdMicros: estimated };

    // Check stop_reason before reading content: a refusal can arrive with an
    // empty content array, or after partial output that must be discarded.
    if (message.stop_reason === "refusal") {
      return { ok: false, code: "PROVIDER_REFUSED", ...billed };
    }

    const output = message.content
      .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const truncated =
      message.stop_reason === "max_tokens" ||
      message.stop_reason === "model_context_window_exceeded";

    if (output.length === 0) {
      // Billed, but nothing to show: typically the output cap was spent on
      // thinking. A run that "succeeded" with an empty answer would mislead.
      return { ok: false, code: "PROVIDER_OUTPUT_LIMIT", ...billed };
    }

    return {
      ok: true,
      output,
      ...billed,
      servedModel: message.model !== model ? message.model : undefined,
      truncated,
    };
  }
}
