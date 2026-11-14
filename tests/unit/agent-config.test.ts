import { describe, expect, it } from "vitest";
import { AgentConfigSchema, AgentDraftConfigSchema, validateForPublish } from "@/modules/contracts";

const completeDraft = {
  role: "תומך לקוחות",
  instructions: "ענה בעברית, בקצרה, ואל תמציא מדיניות החזרות שלא נמסרה לך.",
  provider: "anthropic",
  model: "claude-opus-5",
  tools: [{ toolKey: "kb.search", risk: "read_only" as const }],
  knowledgeBaseIds: [],
  maxSteps: 8,
  maxSpendUsdMicros: 2_000_000,
};

describe("AgentDraftConfigSchema", () => {
  it("accepts an empty object, because that is what a new draft is", () => {
    const parsed = AgentDraftConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.instructions).toBe("");
    expect(parsed.success && parsed.data.maxSteps).toBe(10);
  });

  it("accepts a half-written instruction that the strict schema would reject", () => {
    // The whole reason the draft schema exists: AgentConfigSchema requires 10
    // characters, and an editor that cannot save "ענה " loses the user's work.
    const short = { instructions: "ענה " };
    expect(AgentDraftConfigSchema.safeParse(short).success).toBe(true);
    expect(AgentConfigSchema.safeParse({ ...short, name: "x" }).success).toBe(false);
  });

  it("still refuses input that is wrong rather than unfinished", () => {
    expect(AgentDraftConfigSchema.safeParse({ maxSteps: 0 }).success).toBe(false);
    expect(AgentDraftConfigSchema.safeParse({ maxSteps: 999 }).success).toBe(false);
    expect(AgentDraftConfigSchema.safeParse({ maxSpendUsdMicros: 1.5 }).success).toBe(false);
    expect(AgentDraftConfigSchema.safeParse({ instructions: "x".repeat(20_001) }).success).toBe(
      false,
    );
    expect(
      AgentDraftConfigSchema.safeParse({ tools: [{ toolKey: "Not A Slug", risk: "read_only" }] })
        .success,
    ).toBe(false);
  });

  it("keeps spend as an integer count of micros, never a float", () => {
    // DATA_MODEL.md: "NEVER floating point for invoices".
    expect(AgentDraftConfigSchema.safeParse({ maxSpendUsdMicros: 1_000_000 }).success).toBe(true);
    expect(AgentDraftConfigSchema.safeParse({ maxSpendUsdMicros: 0.5 }).success).toBe(false);
  });
});

describe("validateForPublish", () => {
  it("passes a complete draft and injects the agent's name", () => {
    const result = validateForPublish(completeDraft, "סוכן תמיכה");
    expect(result.ok).toBe(true);
    expect(result.ok && result.config.name).toBe("סוכן תמיכה");
  });

  it("names every missing field, so the user is told what to fix", () => {
    const result = validateForPublish({ role: "תומך" }, "סוכן");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.fields).toContain("instructions");
    expect(result.fields).toContain("provider");
    expect(result.fields).toContain("model");
  });

  it("reports each field once even when it fails several checks", () => {
    const result = validateForPublish({ ...completeDraft, model: "" }, "סוכן");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.fields.filter((f) => f === "model")).toHaveLength(1);
  });

  it("refuses an empty draft, which is what the database also refuses", () => {
    // publish_agent_version() raises AGENT_CONFIG_INVALID on '{}'. Both layers
    // say no; this one says which fields.
    const result = validateForPublish({}, "סוכן");
    expect(result.ok).toBe(false);
  });

  it("does not throw on a non-object draft", () => {
    expect(validateForPublish(null, "סוכן").ok).toBe(false);
    expect(validateForPublish("corrupt", "סוכן").ok).toBe(false);
  });

  it("keeps the published name independent of a later rename", () => {
    // The snapshot records what the version was called when it was published.
    const first = validateForPublish(completeDraft, "שם ראשון");
    const second = validateForPublish(completeDraft, "שם אחרי שינוי");
    expect(first.ok && first.config.name).toBe("שם ראשון");
    expect(second.ok && second.config.name).toBe("שם אחרי שינוי");
  });
});
