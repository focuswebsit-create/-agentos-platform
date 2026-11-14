/**
 * Token prices, as integer micros per 1,000 tokens.
 *
 * Every entry here is versioned, and every usage event records which version
 * priced it (`usage_events.rate_card_version`). Without that, a price change
 * silently rewrites history: last month's run would be re-costed at this
 * month's rate the moment anyone recomputed a total.
 *
 * NOTHING HERE IS A REAL PROVIDER PRICE.
 *
 * The ids are the internal picker keys from `model-registry.ts`, not provider
 * model ids, and the numbers are placeholders chosen to be arithmetically
 * convenient. Real prices come from the provider's own published rate card,
 * checked against their documentation at the time the provider is connected
 * (CLAUDE.md rule 7's posture, applied to pricing). Until then, every cost this
 * produces is an estimate and is recorded as one: `usage_events.estimate_source`
 * is `'estimated'` unless a provider reported the figure itself.
 */

export const RATE_CARD_VERSION = "mock-2026-11";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type Rate = {
  /** Integer micros per 1,000 input tokens. */
  inputMicrosPer1k: number;
  /** Integer micros per 1,000 output tokens. */
  outputMicrosPer1k: number;
};

const RATES: Readonly<Record<string, Rate>> = {
  "mock:deterministic": { inputMicrosPer1k: 100, outputMicrosPer1k: 300 },
  "anthropic:sonnet-family": { inputMicrosPer1k: 3000, outputMicrosPer1k: 15000 },
  "anthropic:haiku-family": { inputMicrosPer1k: 800, outputMicrosPer1k: 4000 },
  "openai:general-family": { inputMicrosPer1k: 2500, outputMicrosPer1k: 10000 },
};

/**
 * Cost in integer micros, rounded UP.
 *
 * Rounding up rather than to nearest, deliberately. The alternative lets a long
 * tail of sub-micro calls each round to zero, so a tenant can spend
 * indefinitely against a cap that never moves. Over-charging by at most one
 * millionth of a dollar per call is the cheaper mistake by a wide margin.
 */
export function priceTokens(model: string, usage: TokenUsage): number | null {
  const rate = RATES[model];
  if (!rate) return null;
  if (!Number.isInteger(usage.inputTokens) || !Number.isInteger(usage.outputTokens)) return null;
  if (usage.inputTokens < 0 || usage.outputTokens < 0) return null;

  return (
    Math.ceil((usage.inputTokens * rate.inputMicrosPer1k) / 1000) +
    Math.ceil((usage.outputTokens * rate.outputMicrosPer1k) / 1000)
  );
}

export function hasRate(model: string): boolean {
  return model in RATES;
}

/** Every model this rate card can price. Used to refuse a run it cannot cost. */
export const PRICED_MODELS: readonly string[] = Object.keys(RATES);
