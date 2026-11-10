import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

/** Run lifecycle states (UI_UX_SPEC.md "Live Runs"). */
export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"];

/** Allowed transitions; the durable runner (P3) must respect these. */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["running", "cancelled", "failed"],
  running: ["waiting_approval", "completed", "failed", "cancelled"],
  waiting_approval: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/** `POST /api/runs` body. Client never supplies cost totals or plan prices. */
export const CreateRunRequestSchema = z
  .object({
    agentId: IdSchema,
    input: z.string().trim().min(1).max(50_000),
    idempotencyKey: IdSchema,
  })
  .strict();
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const RunSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  initiatorId: IdSchema,
  /** Pinned published agent version — runs never execute drafts. */
  agentVersionId: IdSchema,
  status: RunStatusSchema,
  idempotencyKey: IdSchema,
  budgetUsdMicros: z.number().int().nonnegative(),
  reservedUsdMicros: z.number().int().nonnegative(),
  spentUsdMicros: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema.nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunStepSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  runId: IdSchema,
  stepIndex: z.number().int().nonnegative(),
  agentVersionId: IdSchema,
  status: RunStatusSchema,
  kind: z.enum(["model_call", "tool_call", "approval", "handoff"]),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  usageUsdMicros: z.number().int().nonnegative(),
});
export type RunStep = z.infer<typeof RunStepSchema>;
