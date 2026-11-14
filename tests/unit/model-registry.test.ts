// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  hasConfiguredProvider,
  isCatalogModel,
} from "@/modules/agent-engine/model-registry";
import { resolveModelId } from "@/modules/agent-engine/rate-card";

/**
 * The honesty guarantee (CLAUDE.md rule 4): nothing may present itself as able
 * to run an agent unless this deployment can actually call it. The catalog
 * says what exists; only the server decides what is configured.
 *
 * Regression for "Anthropic shows as לא מוגדר": the old catalog hardcoded
 * `configured: false` for every provider, so even a deployment WITH a key
 * could never offer one. Readiness now comes from the server registry.
 */

const saved = {
  key: process.env.ANTHROPIC_API_KEY,
  publicKey: process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY,
  mock: process.env.AGENTOS_ENABLE_MOCK_PROVIDER,
};
const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

// Assembled at runtime so no key-shaped literal is committed.
const FAKE_KEY = ["test", "only", "not", "a", "real", "key", "0123456789"].join("-");

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
  delete process.env.AGENTOS_ENABLE_MOCK_PROVIDER;
});
afterEach(() => {
  restore("ANTHROPIC_API_KEY", saved.key);
  restore("NEXT_PUBLIC_ANTHROPIC_API_KEY", saved.publicKey);
  restore("AGENTOS_ENABLE_MOCK_PROVIDER", saved.mock);
});

describe("the catalog", () => {
  it("carries no readiness of its own - that is the server's to decide", () => {
    for (const p of PROVIDER_CATALOG) expect("configured" in p).toBe(false);
  });

  it("lists Anthropic's current models by their real ids", () => {
    const anthropic = PROVIDER_CATALOG.find((p) => p.id === "anthropic");
    expect(anthropic?.models.map((m) => m.id)).toEqual([
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("marks a provider without an implementation as not selectable", () => {
    const openai = PROVIDER_CATALOG.find((p) => p.id === "openai");
    expect(openai?.implemented).toBe(false);
    expect(openai?.models).toEqual([]);
  });

  it("validates provider/model pairs, including legacy keys once resolved", () => {
    expect(isCatalogModel("anthropic", "claude-opus-5-5")).toBe(true);
    expect(isCatalogModel("anthropic", resolveModelId("anthropic:sonnet-family"))).toBe(true);
    expect(isCatalogModel("anthropic", "mock:deterministic")).toBe(false);
    expect(isCatalogModel("openai", "gpt-anything")).toBe(false);
    expect(isCatalogModel("nope", "claude-opus-5-5")).toBe(false);
  });
});

describe("studioProviderOptions - what Studio is told on this deployment", () => {
  it("without a key: Anthropic is listed but not configured, and the mock is hidden", async () => {
    const { studioProviderOptions } = await import("@/modules/agent-engine/registry");
    const options = studioProviderOptions();
    expect(options.find((p) => p.id === "anthropic")?.configured).toBe(false);
    expect(options.find((p) => p.id === "mock")).toBeUndefined();
    expect(hasConfiguredProvider(options)).toBe(false);
  });

  it("with a server-side key: Anthropic is configured", async () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    const { studioProviderOptions } = await import("@/modules/agent-engine/registry");
    expect(studioProviderOptions().find((p) => p.id === "anthropic")?.configured).toBe(true);
  });

  it("refuses a key that has leaked to a NEXT_PUBLIC_ name, rather than using the server copy", async () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY = FAKE_KEY;
    const { studioProviderOptions } = await import("@/modules/agent-engine/registry");
    expect(studioProviderOptions().find((p) => p.id === "anthropic")?.configured).toBe(false);
  });

  it("offers the simulation only when enabled, and labelled as one", async () => {
    process.env.AGENTOS_ENABLE_MOCK_PROVIDER = "1";
    const { studioProviderOptions } = await import("@/modules/agent-engine/registry");
    const mock = studioProviderOptions().find((p) => p.id === "mock");
    expect(mock?.configured).toBe(true);
    expect(mock?.simulation).toBe(true);
  });

  it("never puts the key, or any part of it, in what it returns", async () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    const { studioProviderOptions } = await import("@/modules/agent-engine/registry");
    const serialized = JSON.stringify(studioProviderOptions());
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain(FAKE_KEY.slice(-10));
  });

  it("never marks an unimplemented provider configured", async () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    process.env.AGENTOS_ENABLE_MOCK_PROVIDER = "1";
    const { studioProviderOptions } = await import("@/modules/agent-engine/registry");
    for (const p of studioProviderOptions()) {
      if (!p.implemented) expect(p.configured).toBe(false);
    }
  });
});
