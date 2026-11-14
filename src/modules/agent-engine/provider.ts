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
  /**
   * The model key stored on the agent version: a real model id such as
   * "claude-sonnet-5-5", or a legacy picker key that `resolveModelId()` maps
   * to one. Each provider resolves it; the executor does not.
   */
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
  /**
   * The provider's own estimate, when it can price more precisely than the
   * executor - e.g. a request that ran on more than one model because a
   * server-side fallback served it, where each attempt has its own rate. Still
   * an estimate, and recorded as one.
   */
  estimatedCostUsdMicros?: number | null;
  /** The model that actually produced the answer, when it differs from the request. */
  servedModel?: string;
  /** True when the answer stopped at the output cap rather than finishing. */
  truncated?: boolean;
};

export type ProviderFailureCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REFUSED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_CANCELLED"
  /** The provider rejected the server's key. An operator problem, not the tenant's. */
  | "PROVIDER_AUTH"
  /** The provider rejected the request as malformed or unsupported. Retrying will not help. */
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_RATE_LIMITED"
  /** Billed, but the output cap was reached before any answer text was produced. */
  | "PROVIDER_OUTPUT_LIMIT"
  /** Refused before sending: the run's budget cannot cover even a minimal answer. */
  | "BUDGET_TOO_LOW";

export type ProviderFailure = {
  ok: false;
  /** Stable, short, and safe to store. Never the provider's raw message. */
  code: ProviderFailureCode;
  /** Usage incurred before the failure. Null when nothing was sent. */
  usage: TokenUsage | null;
  reportedCostUsdMicros: number | null;
  estimatedCostUsdMicros?: number | null;
};

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface ModelProvider {
  /** Matches `ProviderOption.id` in model-registry.ts and `config.provider` on an agent. */
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
