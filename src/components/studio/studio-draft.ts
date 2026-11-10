import { AgentConfigSchema, type AgentConfig, type ToolRisk } from "@/modules/contracts";

/** Local, in-memory form state of the Agent Studio preview. Never persisted in P0. */
export interface StudioDraft {
  name: string;
  role: string;
  instructions: string;
  provider: string;
  model: string;
  tools: { toolKey: string; risk: ToolRisk }[];
  maxSteps: number;
  /** User-entered USD amount (decimal); converted to integer micros for the schema. */
  maxSpendUsd: number;
}

export type StudioField = keyof AgentConfig;

export type StudioValidation =
  { ok: true; config: AgentConfig } | { ok: false; fields: StudioField[] };

const USD_MICROS = 1_000_000;

export function toAgentConfigInput(draft: StudioDraft): unknown {
  return {
    name: draft.name,
    role: draft.role,
    instructions: draft.instructions,
    provider: draft.provider,
    model: draft.model,
    tools: draft.tools,
    knowledgeBaseIds: [],
    maxSteps: draft.maxSteps,
    maxSpendUsdMicros: Number.isFinite(draft.maxSpendUsd)
      ? Math.round(draft.maxSpendUsd * USD_MICROS)
      : Number.NaN,
  };
}

/** Validates the draft against the shared contract (same schema the API will use in P2). */
export function validateStudioDraft(draft: StudioDraft): StudioValidation {
  const result = AgentConfigSchema.safeParse(toAgentConfigInput(draft));
  if (result.success) return { ok: true, config: result.data };
  const fields = new Set<StudioField>();
  for (const issue of result.error.issues) {
    const head = issue.path[0];
    if (typeof head === "string") fields.add(head as StudioField);
  }
  return { ok: false, fields: [...fields] };
}
