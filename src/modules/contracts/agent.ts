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
