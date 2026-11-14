/**
 * The provider and model catalog Agent Studio renders (PRD section 9).
 *
 * Static and safe to import in the browser: it says what EXISTS, never whether
 * it is ready. Readiness depends on server-side keys and flags, so only the
 * server can answer it — `studioProviderOptions()` in `registry.ts` takes this
 * catalog, marks each entry `configured` or not, and passes the result to the
 * editor as a prop. A client component that decided readiness for itself would
 * either need the key (never) or guess (a fictional integration).
 *
 * Model ids are the provider's real ids, sent as-is. Agents published earlier
 * with the legacy keys "anthropic:sonnet-family" / "anthropic:haiku-family"
 * keep running: `resolveModelId()` in rate-card.ts maps them.
 */
export interface ModelOption {
  id: string;
  label: string;
}

export interface CatalogProvider {
  id: string;
  label: string;
  /**
   * True for the deterministic test provider. Rendered with an explicit
   * "simulation" label, and only ever offered when the server enables it.
   */
  simulation?: boolean;
  /** False when no implementation exists yet: shown, never selectable. */
  implemented: boolean;
  models: readonly ModelOption[];
}

export interface ProviderOption extends CatalogProvider {
  /** Decided on the server, from keys and flags the browser never sees. */
  configured: boolean;
}

export const PROVIDER_CATALOG: readonly CatalogProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    implemented: true,
    models: [
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    implemented: false,
    models: [],
  },
  {
    id: "mock",
    label: "Simulation",
    simulation: true,
    implemented: true,
    models: [{ id: "mock:deterministic", label: "Deterministic simulation" }],
  },
];

/** Whether `model` is one this catalog lists for `provider`. Used at publish. */
export function isCatalogModel(provider: string, model: string): boolean {
  const entry = PROVIDER_CATALOG.find((p) => p.id === provider);
  return entry?.implemented === true && entry.models.some((m) => m.id === model);
}

export function hasConfiguredProvider(providers: readonly ProviderOption[]): boolean {
  return providers.some((p) => p.configured);
}
