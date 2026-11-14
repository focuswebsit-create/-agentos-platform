import type { TokenUsage } from "./rate-card";

/**
 * The boundary between this product and whoever generates the tokens.
 *
 * One interface, so connecting a real provider is one new file and one registry
 * entry rather than a change to the executor. The executor never learns which
 * provider it is talking to, which is also what makes it testable without one.
 *
 * Three rules every implementation keeps:
 *
 *  1. **It never throws for a provider-side failure.** A refused request, a
 *     rate limit and a timeout are outcomes, not exceptions: the run has to
 *     record them, settle its budget and finish. An implementation that threw
 *     would leave the reservation held until the sweeper found it.
 *  2. **It reports usage even when it fails.** A call that was billed and then
 *     errored still costs money. `usage` is null only when nothing was sent.
 *  3. **It never returns a secret, and never puts one in an error.** Keys are
 *     read server-side, used, and not referred to again.
 */

export type ProviderRequest = {
  /** Internal picker key, e.g. "anthropic:sonnet-family". Never a real model id. */
  model: string;
  systemPrompt: string;
  userInput: string;
  maxSteps: number;
  /** Upper bound for this single call, in integer micros. */
  maxSpendUsdMicros: number;
  /** Aborts the call. The executor wires this to cancellation. */
  signal?: AbortSignal;
};

export type ProviderSuccess = {
  ok: true;
  /** The model's answer. Shown to the user; never logged alongside the prompt. */
  output: string;
  usage: TokenUsage;
  /**
   * Cost as the PROVIDER reported it, if it reports one. Null means the rate
   * card has to estimate, and `usage_events.estimate_source` records which it
   * was — a bill built from estimates without saying so is a fabricated number.
   */
  reportedCostUsdMicros: number | null;
};

export type ProviderFailure = {
  ok: false;
  /** Stable, short, and safe to store. Never the provider's raw message. */
  code: "PROVIDER_UNAVAILABLE" | "PROVIDER_REFUSED" | "PROVIDER_TIMEOUT" | "PROVIDER_CANCELLED";
  /** Usage incurred before the failure. Null when nothing was sent. */
  usage: TokenUsage | null;
  reportedCostUsdMicros: number | null;
};

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface ModelProvider {
  /** Matches `ProviderOption.id` in model-registry.ts. */
  readonly id: string;
  /**
   * Whether this provider can actually be called right now — for a real
   * provider, whether its key is present server-side. The executor refuses to
   * dispatch to an unconfigured provider rather than failing mid-run, and the
   * UI uses the same answer so it never offers what it cannot do.
   */
  isConfigured(): boolean;
  complete(request: ProviderRequest): Promise<ProviderResult>;
}
