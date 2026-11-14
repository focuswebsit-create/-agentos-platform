import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS, hasConfiguredProvider } from "@/modules/agent-engine/model-registry";

/**
 * These assertions were part of the P0 studio-preview suite, which went away
 * when the real Agent Studio replaced the preview. They are kept, and kept
 * separate, because they are the honesty guarantee rather than a test of that
 * screen: until P3 wires a real provider, nothing in this product may present
 * itself as able to run an agent (CLAUDE.md rule 4).
 */
describe("model registry", () => {
  it("has no configured provider, so nothing can claim to run", () => {
    expect(hasConfiguredProvider()).toBe(false);
    expect(MODEL_PROVIDERS.every((p) => !p.configured)).toBe(true);
  });

  it("offers at least one model per provider, with picker keys not real model ids", () => {
    for (const provider of MODEL_PROVIDERS) {
      expect(provider.models.length).toBeGreaterThan(0);
      for (const model of provider.models) {
        // Internal picker keys are namespaced "provider:family". Real provider
        // model ids are configured server-side in P3, after checking the
        // official docs — inventing one here would be a fictional integration.
        expect(model.id.startsWith(`${provider.id}:`)).toBe(true);
      }
    }
  });

  it("reports a configured provider when one exists", () => {
    expect(hasConfiguredProvider([{ id: "x", label: "X", configured: true, models: [] }])).toBe(
      true,
    );
  });
});
