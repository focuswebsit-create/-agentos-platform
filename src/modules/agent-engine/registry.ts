import "server-only";
import type { ModelProvider } from "./provider";
import { MockProvider } from "./providers/mock";
import { AnthropicProvider } from "./providers/anthropic";
import { PROVIDER_CATALOG, type ProviderOption } from "./model-registry";

/**
 * Which providers this deployment can actually call.
 *
 * Separate from `model-registry.ts`, which is the catalog the Studio pickers
 * render. That one says what exists; this one says what will answer.
 *
 * - **Anthropic** is always registered, and is configured exactly when
 *   `ANTHROPIC_API_KEY` is present server-side. Without it, the executor
 *   refuses to dispatch (`PROVIDER_NOT_CONFIGURED`) and Studio says so.
 * - **The mock** is registered only when `AGENTOS_ENABLE_MOCK_PROVIDER=1`.
 *   Production does not set it, so a deployment cannot quietly serve simulated
 *   answers to a paying customer.
 *
 * Adding a provider: one file implementing `ModelProvider`, one entry in
 * `build()`, one entry in PROVIDER_CATALOG, and its prices in rate-card.ts.
 */

export function isMockProviderEnabled(): boolean {
  return process.env.AGENTOS_ENABLE_MOCK_PROVIDER === "1";
}

function build(): Map<string, ModelProvider> {
  const providers = new Map<string, ModelProvider>();
  const anthropic = new AnthropicProvider();
  providers.set(anthropic.id, anthropic);
  if (isMockProviderEnabled()) {
    const mock = new MockProvider();
    providers.set(mock.id, mock);
  }
  return providers;
}

/** Rebuilt per call: tests toggle the flags, and a cached map would ignore them. */
export function getProvider(id: string): ModelProvider | null {
  return build().get(id) ?? null;
}

export function configuredProviderIds(): string[] {
  return [...build().values()].filter((p) => p.isConfigured()).map((p) => p.id);
}

export function hasAnyConfiguredProvider(): boolean {
  return configuredProviderIds().length > 0;
}

export function isProviderConfigured(id: string): boolean {
  return getProvider(id)?.isConfigured() ?? false;
}

/**
 * The catalog as Studio should render it on THIS deployment: each entry marked
 * configured or not, and the simulation provider omitted entirely unless it is
 * enabled. Booleans only — no key, no key length, no hint of one.
 */
export function studioProviderOptions(): ProviderOption[] {
  const ready = new Set(configuredProviderIds());
  return PROVIDER_CATALOG.filter((p) => !p.simulation || isMockProviderEnabled()).map((p) => ({
    ...p,
    configured: p.implemented && ready.has(p.id),
  }));
}
