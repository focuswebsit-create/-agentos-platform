import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStudioPreview, type StudioCopy } from "@/components/studio/agent-studio-preview";
import { validateStudioDraft, type StudioDraft } from "@/components/studio/studio-draft";
import { getDictionary } from "@/i18n";
import { MODEL_PROVIDERS, hasConfiguredProvider } from "@/modules/agent-engine/model-registry";

const t = getDictionary("he");
const copy: StudioCopy = { ...t.studio, preview: t.common.preview };

const valid: StudioDraft = {
  name: "כותב תוכן",
  role: "מנסח טיוטות",
  instructions: "כתוב טיוטות קצרות וברורות בעברית.",
  provider: "anthropic",
  model: "anthropic:sonnet-family",
  tools: [],
  maxSteps: 8,
  maxSpendUsd: 0.5,
};

describe("validateStudioDraft", () => {
  it("accepts a complete draft and converts USD to integer micros", () => {
    const res = validateStudioDraft(valid);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.maxSpendUsdMicros).toBe(500_000);
  });

  it("reports missing fields", () => {
    const res = validateStudioDraft({ ...valid, name: "", instructions: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fields).toEqual(expect.arrayContaining(["name", "instructions"]));
  });

  it("rejects non-numeric limits", () => {
    const res = validateStudioDraft({ ...valid, maxSteps: Number.NaN, maxSpendUsd: Number.NaN });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.fields).toEqual(expect.arrayContaining(["maxSteps", "maxSpendUsdMicros"]));
  });
});

describe("model registry (P0)", () => {
  it("has no configured provider", () => {
    expect(hasConfiguredProvider()).toBe(false);
    expect(MODEL_PROVIDERS.every((p) => !p.configured)).toBe(true);
  });
});

describe("<AgentStudioPreview />", () => {
  it("keeps Save, Publish and Run disabled (no fake execution)", () => {
    render(<AgentStudioPreview copy={copy} />);
    expect(screen.getByRole("button", { name: copy.actions.saveDraft })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.actions.publish })).toBeDisabled();
    expect(screen.getByTestId("studio-run")).toBeDisabled();
    expect(screen.getByText(copy.test.disabledReason)).toBeInTheDocument();
    expect(screen.getByText(copy.test.outputEmpty)).toBeInTheDocument();
  });

  it("marks unconfigured providers in the picker", () => {
    render(<AgentStudioPreview copy={copy} />);
    expect(
      screen.getByRole("option", { name: `Anthropic — ${copy.model.notConfigured}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.model.setupNotice)).toBeInTheDocument();
  });

  it("validates live against the shared schema", () => {
    render(<AgentStudioPreview copy={copy} />);
    const status = screen.getByTestId("studio-validation");
    expect(status).toHaveTextContent(copy.validation.fields.name);

    fireEvent.change(screen.getByLabelText(copy.identity.name), { target: { value: valid.name } });
    fireEvent.change(screen.getByLabelText(copy.identity.role), { target: { value: valid.role } });
    fireEvent.change(screen.getByLabelText(copy.instructions.label), {
      target: { value: valid.instructions },
    });

    expect(status).toHaveTextContent(copy.validation.valid);
    // Still nothing can be saved or run.
    expect(screen.getByRole("button", { name: copy.actions.publish })).toBeDisabled();
    expect(screen.getByTestId("studio-run")).toBeDisabled();
  });
});
