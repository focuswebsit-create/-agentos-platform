import { z } from "zod";

/** Stable problem codes from API_CONTRACT.md "Error taxonomy". */
export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "ORG_ACCESS_DENIED",
  "PLAN_FEATURE_UNAVAILABLE",
  "SEAT_LIMIT_REACHED",
  "USAGE_LIMIT_REACHED",
  "RUN_CONCURRENCY_LIMIT",
  "TRIAL_EXPIRED",
  "SUBSCRIPTION_PAST_DUE",
  "BILLING_NOT_CONFIGURED",
  "INVALID_WEBHOOK_SIGNATURE",
  "PAYMENT_PENDING",
  "AGENT_VERSION_MISSING",
  "APPROVAL_EXPIRED",
  "RATE_LIMITED",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Error envelope `{code,message,requestId}`. */
export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  requestId: z.uuid(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
