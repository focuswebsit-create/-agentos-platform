import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

export const AgentStatusSchema = z.enum(["draft", "published", "archived"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** How risky a tool is. Anything other than `read_only` requires human approval of exact args. */
export const ToolRiskSchema = z.enum(["read_only", "requires_approval"]);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

export const ToolGrantSchema = z.object({
  toolKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_.-]*$/, "tool key must be lowercase slug"),
  risk: ToolRiskSchema,
});
export type ToolGrant = z.infer<typeof ToolGrantSchema>;

/**
 * Agent configuration as edited in Agent Studio.
 * Published versions snapshot this config immutably (agent_versions.config_json).
 */
export const AgentConfigSchema = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.string().trim().min(2).max(120),
  instructions: z.string().trim().min(10).max(20_000),
  provider: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(ToolGrantSchema).max(20),
  knowledgeBaseIds: z.array(IdSchema).max(20).default([]),
  /** Hard caps enforced server-side by the runtime (P3), shown here for transparency. */
  maxSteps: z.number().int().min(1).max(50),
  maxSpendUsdMicros: z
    .number()
    .int()
    .min(1)
    .max(100 * 1_000_000),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AgentSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  name: z.string(),
  status: AgentStatusSchema,
  activeVersionId: IdSchema.nullable(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentVersionSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  agentId: IdSchema,
  version: z.number().int().positive(),
  config: AgentConfigSchema,
  publishedAt: TimestampSchema,
  createdBy: IdSchema,
});
export type AgentVersion = z.infer<typeof AgentVersionSchema>;

/**
 * A draft under edit, which is partial by nature: you open Agent Studio with an
 * empty configuration and fill it in over several sittings.
 *
 * This is NOT `AgentConfigSchema.partial()`. That keeps each field's inner
 * validators, so a half-written instruction would fail `min(10)` and the editor
 * could not save it — which is precisely what a draft is for. The bounds here
 * are the ones that still matter while drafting: an upper limit, so a runaway
 * paste cannot fill the row, and a valid shape for the structured fields.
 *
 * The strict schema above is what a version must satisfy to be PUBLISHED.
 * `validateForPublish()` is the single place that gate is applied.
 */
export const AgentDraftConfigSchema = z.object({
  role: z.string().trim().max(120).default(""),
  instructions: z.string().trim().max(20_000).default(""),
  provider: z.string().trim().max(64).default(""),
  model: z.string().trim().max(120).default(""),
  tools: z.array(ToolGrantSchema).max(20).default([]),
  knowledgeBaseIds: z.array(IdSchema).max(20).default([]),
  maxSteps: z.number().int().min(1).max(50).default(10),
  maxSpendUsdMicros: z
    .number()
    .int()
    .min(1)
    .max(100 * 1_000_000)
    .default(1_000_000),
});
export type AgentDraftConfig = z.infer<typeof AgentDraftConfigSchema>;

/**
 * The publish gate.
 *
 * `name` is injected from the agent row rather than edited in the config, and
 * the published snapshot keeps its own copy on purpose: renaming an agent next
 * month must not rewrite what a version published today was called. The version
 * is a record of what ran.
 *
 * `publish_agent_version()` independently refuses an empty configuration, which
 * is the database's floor rather than a substitute for this. QUALITY_GATES.md
 * requires Zod at the endpoint; the SQL check is what remains true if a future
 * caller forgets.
 */
export function validateForPublish(
  draft: unknown,
  agentName: string,
): { ok: true; config: AgentConfig } | { ok: false; fields: string[] } {
  const parsed = AgentConfigSchema.safeParse({
    ...(typeof draft === "object" && draft !== null ? draft : {}),
    name: agentName,
  });
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "config"))],
  };
}
