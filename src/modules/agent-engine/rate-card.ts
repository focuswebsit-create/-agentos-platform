/**
 * Token prices, as integer micros per 1,000 tokens.
 *
 * Every entry here is versioned, and every usage event records which version
 * priced it (`usage_events.rate_card_version`). Without that, a price change
 * silently rewrites history: last month's run would be re-costed at this
 * month's rate the moment anyone recomputed a total.
 *
 * SOURCES, AND WHAT THESE NUMBERS ARE
 *
 * The Anthropic rows are Anthropic's published list prices for the Claude API
 * as of RATE_CARD_VERSION ($ per million tokens -> micros per thousand: $4/MTok
 * is 4,000 micros/1K). They are what AgentOS charges a tenant's spend cap, not
 * an invoice from Anthropic: the API does not report a cost per request, so
 * every Anthropic usage event is recorded with `estimate_source = 'estimated'`.
 * Re-check them against Anthropic's pricing page whenever this version changes.
 *
 * The mock row is not a price at all. It exists so the deterministic test
 * provider exercises the same arithmetic a real one does.
 *
 * CONSERVATIVE BY CONSTRUCTION
 *
 * Everything here errs towards charging the cap slightly MORE than the real
 * bill, never less, because the failure in the other direction is a tenant
 * spending past a limit they set:
 *
 *  - costs round up, per side;
 *  - cache reads are priced at the full input rate and cache writes at 1.25x
 *    input (AgentOS sets no cache_control, so both should be zero anyway);
 *  - a Claude model this card does not list — possible when a server-side
 *    fallback serves the request on another model — is priced at
 *    UNKNOWN_CLAUDE_RATE, the highest Claude list price known to this card.
 */

export const RATE_CARD_VERSION = "anthropic-list-2026-11-14";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache tokens. Optional: most providers and the mock report none. */
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

type Rate = {
  /** Integer micros per 1,000 input tokens. */
  inputMicrosPer1k: number;
  /** Integer micros per 1,000 output tokens. */
  outputMicrosPer1k: number;
  /**
   * A higher tier for long prompts, where the provider publishes one. Applies
   * to the whole request when its prompt exceeds `aboveInputTokens`.
   */
  longPrompt?: { aboveInputTokens: number; inputMicrosPer1k: number; outputMicrosPer1k: number };
};

const RATES: Readonly<Record<string, Rate>> = {
  "mock:deterministic": { inputMicrosPer1k: 100, outputMicrosPer1k: 300 },

  // Current models offered in Agent Studio.
  "claude-opus-5-5": { inputMicrosPer1k: 4_000, outputMicrosPer1k: 20_000 },
  "claude-sonnet-5-5": { inputMicrosPer1k: 2_000, outputMicrosPer1k: 10_000 },
  "claude-haiku-5-5": {
    inputMicrosPer1k: 100,
    outputMicrosPer1k: 500,
    longPrompt: { aboveInputTokens: 100_000, inputMicrosPer1k: 500, outputMicrosPer1k: 2_500 },
  },

  // Models a server-side fallback can serve a declined request on. Listed so
  // such an attempt is priced at its own rate rather than the ceiling.
  "claude-opus-5": { inputMicrosPer1k: 5_000, outputMicrosPer1k: 25_000 },
  "claude-opus-4-8": { inputMicrosPer1k: 5_000, outputMicrosPer1k: 25_000 },
};

/** The highest Claude list price this card knows ($10 / $50 per MTok). */
export const UNKNOWN_CLAUDE_RATE: Rate = { inputMicrosPer1k: 10_000, outputMicrosPer1k: 50_000 };

/**
 * Picker keys that agents stored before real model ids existed. Published
 * versions are immutable, so an agent published with one of these must keep
 * running; it runs on the current model of the same family.
 */
const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "anthropic:sonnet-family": "claude-sonnet-5-5",
  "anthropic:haiku-family": "claude-haiku-5-5",
};

/** The real model id a stored model key runs on. Unknown keys pass through unchanged. */
export function resolveModelId(model: string): string {
  return LEGACY_MODEL_ALIASES[model] ?? model;
}

function validCount(n: number | undefined): boolean {
  return n === undefined || (Number.isInteger(n) && n >= 0);
}

function rateFor(model: string): Rate | null {
  const id = resolveModelId(model);
  const rate = RATES[id];
  if (rate) return rate;
  // Only Claude ids fall back to the ceiling. An unknown model of any other
  // provider is a bug to surface, not something to guess a price for.
  return id.startsWith("claude-") ? UNKNOWN_CLAUDE_RATE : null;
}

function effectiveRate(rate: Rate, promptTokens: number) {
  return rate.longPrompt && promptTokens > rate.longPrompt.aboveInputTokens
    ? rate.longPrompt
    : rate;
}

/**
 * Cost in integer micros, rounded UP.
 *
 * Rounding up rather than to nearest, deliberately. The alternative lets a long
 * tail of sub-micro calls each round to zero, so a tenant can spend
 * indefinitely against a cap that never moves. Over-charging by at most one
 * millionth of a dollar per call is the cheaper mistake by a wide margin.
 */
export function priceTokens(model: string, usage: TokenUsage): number | null {
  const rate = rateFor(model);
  if (!rate) return null;
  if (
    !validCount(usage.inputTokens) ||
    !validCount(usage.outputTokens) ||
    !validCount(usage.cacheReadInputTokens) ||
    !validCount(usage.cacheCreationInputTokens)
  ) {
    return null;
  }

  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const promptTokens = usage.inputTokens + cacheRead + cacheWrite;
  const r = effectiveRate(rate, promptTokens);

  return (
    Math.ceil(((usage.inputTokens + cacheRead) * r.inputMicrosPer1k) / 1000) +
    Math.ceil((cacheWrite * r.inputMicrosPer1k * 5) / 4000) +
    Math.ceil((usage.outputTokens * r.outputMicrosPer1k) / 1000)
  );
}

/**
 * The most a single call can cost: `promptTokens` in (an upper bound, not an
 * estimate) and `maxOutputTokens` out, at the long-prompt tier if it applies.
 */
export function worstCaseCost(
  model: string,
  promptTokens: number,
  maxOutputTokens: number,
): number | null {
  const rate = rateFor(model);
  if (!rate) return null;
  const r = effectiveRate(rate, promptTokens);
  return (
    Math.ceil((promptTokens * r.inputMicrosPer1k) / 1000) +
    Math.ceil((maxOutputTokens * r.outputMicrosPer1k) / 1000)
  );
}

/** Output micros per 1,000 tokens at the tier `promptTokens` lands in. */
export function outputRatePer1k(model: string, promptTokens: number): number | null {
  const rate = rateFor(model);
  return rate ? effectiveRate(rate, promptTokens).outputMicrosPer1k : null;
}

export function hasRate(model: string): boolean {
  return resolveModelId(model) in RATES;
}

/** Every model this rate card lists. */
export const PRICED_MODELS: readonly string[] = Object.keys(RATES);
