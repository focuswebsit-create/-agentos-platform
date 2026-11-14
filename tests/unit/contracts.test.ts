import { describe, expect, it } from "vitest";
import {
  AgentConfigSchema,
  ApiErrorSchema,
  canTransition,
  CreateRunRequestSchema,
  ERROR_CODES,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  SubscriptionSchema,
  SUBSCRIPTION_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "@/modules/contracts";

const uuid = "8b5c2a8e-3f1d-4c6b-9a7e-2d4f6b8a1c3e";

const validAgent = {
  name: "Content writer",
  role: "Drafts posts",
  instructions: "Write concise, friendly drafts in Hebrew.",
  provider: "anthropic",
  model: "anthropic:sonnet-family",
  tools: [{ toolKey: "knowledge.search", risk: "read_only" }],
  maxSteps: 8,
  maxSpendUsdMicros: 500_000,
};

describe("AgentConfigSchema", () => {
  it("accepts a valid config and defaults knowledgeBaseIds", () => {
    const parsed = AgentConfigSchema.parse(validAgent);
    expect(parsed.knowledgeBaseIds).toEqual([]);
  });

  it.each([
    ["short name", { name: "a" }],
    ["short instructions", { instructions: "too short" }],
    ["zero steps", { maxSteps: 0 }],
    ["too many steps", { maxSteps: 51 }],
    ["fractional spend", { maxSpendUsdMicros: 1.5 }],
    ["bad tool key", { tools: [{ toolKey: "Shell Exec", risk: "read_only" }] }],
    ["unknown tool risk", { tools: [{ toolKey: "x", risk: "admin" }] }],
  ])("rejects %s", (_label, patch) => {
    expect(AgentConfigSchema.safeParse({ ...validAgent, ...patch }).success).toBe(false);
  });
});

describe("Run contracts", () => {
  it("accepts a valid create-run request", () => {
    expect(
      CreateRunRequestSchema.safeParse({ agentId: uuid, input: "Summarize", idempotencyKey: uuid })
        .success,
    ).toBe(true);
  });

  it("rejects client-supplied cost or plan fields (strict)", () => {
    const res = CreateRunRequestSchema.safeParse({
      agentId: uuid,
      input: "Summarize",
      idempotencyKey: uuid,
      costUsd: 0,
    });
    expect(res.success).toBe(false);
  });

  it("requires an idempotency key", () => {
    expect(CreateRunRequestSchema.safeParse({ agentId: uuid, input: "x" }).success).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of TERMINAL_RUN_STATUSES) expect(RUN_TRANSITIONS[s]).toEqual([]);
  });

  it("defines transitions for every status and only to known statuses", () => {
    for (const s of RUN_STATUSES) {
      for (const to of RUN_TRANSITIONS[s]) expect(RUN_STATUSES).toContain(to);
    }
  });

  it("enforces the lifecycle", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "waiting_approval")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
  });
});

describe("Subscription contracts", () => {
  it("covers the documented state machine", () => {
    expect(SUBSCRIPTION_STATUSES).toEqual([
      "trialing",
      "active",
      "past_due",
      "grace",
      "suspended",
      "canceled",
      "expired",
    ]);
  });

  it("rejects unknown states", () => {
    const sub = {
      id: uuid,
      orgId: uuid,
      planCode: "business",
      planVersion: 1,
      provider: "sandbox",
      providerCustomerId: "c_1",
      providerSubscriptionId: "s_1",
      status: "paid",
      trialEndsAt: null,
      currentPeriodStart: "2026-11-01T00:00:00Z",
      currentPeriodEnd: "2026-12-01T00:00:00Z",
      cancelAtPeriodEnd: false,
      updatedAt: "2026-11-01T00:00:00Z",
    };
    expect(SubscriptionSchema.safeParse(sub).success).toBe(false);
    expect(SubscriptionSchema.safeParse({ ...sub, status: "active" }).success).toBe(true);
  });
});

describe("Error taxonomy", () => {
  it("contains the API_CONTRACT.md codes", () => {
    expect(ERROR_CODES).toContain("USAGE_LIMIT_REACHED");
    expect(ERROR_CODES).toContain("BILLING_NOT_CONFIGURED");
  });

  it("contains the P1 auth and tenancy codes", () => {
    // API_CONTRACT.md's taxonomy predates authentication, so P1 adds these.
    // Folding them into AUTH_REQUIRED or ORG_ACCESS_DENIED would make
    // genuinely different failures indistinguishable to a client.
    for (const code of [
      "MFA_REQUIRED",
      "INVITATION_INVALID",
      "ORG_SLUG_TAKEN",
      "EMAIL_NOT_VERIFIED",
      "STALE_ORG_CONTEXT",
      "CSRF_INVALID",
      "VALIDATION_FAILED",
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it("contains the P2 agent codes, and deliberately no AGENT_NOT_FOUND", () => {
    for (const code of [
      "AGENT_ARCHIVED",
      "AGENT_CONFIG_INVALID",
      "AGENT_VERSION_IMMUTABLE",
      "TEMPLATE_NOT_AVAILABLE",
      "ORG_SUSPENDED",
      "DATABASE_NOT_PROVISIONED",
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
    // An unknown agent id and an agent in another organisation both answer
    // ORG_ACCESS_DENIED. A separate code would confirm that a given agent
    // exists to someone who cannot otherwise see it (ADR-0008).
    expect(ERROR_CODES).not.toContain("AGENT_NOT_FOUND");
  });

  it("has no duplicates and a known size, so a code is never added by accident", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toHaveLength(29);
  });

  it("validates the error envelope", () => {
    expect(
      ApiErrorSchema.safeParse({ code: "RATE_LIMITED", message: "slow down", requestId: uuid })
        .success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: "NOPE", message: "x", requestId: uuid }).success).toBe(
      false,
    );
  });
});
