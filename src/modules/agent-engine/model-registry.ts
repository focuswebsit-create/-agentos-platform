/**
 * Model provider registry — config-driven, never hardcoded in UI logic (PRD §9).
 *
 * P0: display-only. Every provider is `configured: false`; there are no SDKs,
 * no keys and no calls. P3 will load this from server config and verify that the
 * provider credentials exist server-side before enabling Run.
 * The `id`s below are internal picker keys, NOT real provider model IDs. Real model
 * IDs are configured server-side in P3 after checking official provider docs.
 */
export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderOption {
  id: string;
  label: string;
  configured: boolean;
  models: readonly ModelOption[];
}

export const MODEL_PROVIDERS: readonly ProviderOption[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    configured: false,
    models: [
      { id: "anthropic:sonnet-family", label: "Claude Sonnet" },
      { id: "anthropic:haiku-family", label: "Claude Haiku" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    configured: false,
    models: [{ id: "openai:general-family", label: "GPT (general)" }],
  },
];

export function hasConfiguredProvider(providers: readonly ProviderOption[] = MODEL_PROVIDERS) {
  return providers.some((p) => p.configured);
}
