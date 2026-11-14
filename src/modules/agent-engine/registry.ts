import "server-only";
import type { ModelProvider } from "./provider";
import { MockProvider } from "./providers/mock";

/**
 * Which providers this deployment can actually call.
 *
 * Separate from `model-registry.ts`, which is the display list the Studio
 * pickers render. That one says what exists; this one says what will answer.
 * Keeping them apart is what lets the UI offer a provider marked "not
 * configured" without the executor ever being able to dispatch to it.
 *
 * The mock is only registered when `AGENTOS_ENABLE_MOCK_PROVIDER` is set.
 * Production does not set it, so a deployment cannot quietly serve simulated
 * answers to a paying customer — the failure is "no provider", which is true,
 * rather than a fabricated reply, which is not.
 *
 * No real provider is registered. Connecting one is a new file implementing
 * `ModelProvider`, one entry below, and the owner's decision to accept charges
 * on their account.
 */

function build(): Map<string, ModelProvider> {
  const providers = new Map<string, ModelProvider>();
  if (process.env.AGENTOS_ENABLE_MOCK_PROVIDER === "1") {
    const mock = new MockProvider();
    providers.set(mock.id, mock);
  }
  return providers;
}

/** Rebuilt per call: tests toggle the flag, and a cached map would ignore them. */
export function getProvider(id: string): ModelProvider | null {
  return build().get(id) ?? null;
}

export function configuredProviderIds(): string[] {
  return [...build().values()].filter((p) => p.isConfigured()).map((p) => p.id);
}

export function hasAnyConfiguredProvider(): boolean {
  return configuredProviderIds().length > 0;
}
