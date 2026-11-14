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

  /**
   * P1 additions. API_CONTRACT.md's taxonomy predates authentication and
   * tenancy, so these had no entry. Added explicitly rather than folded into
   * AUTH_REQUIRED or ORG_ACCESS_DENIED, which would have made genuinely
   * different failures indistinguishable to a client (CLAUDE.md rule 14).
   * API_CONTRACT.md is updated in the same change.
   */
  /** A platform-admin route reached without a verified second factor. */
  "MFA_REQUIRED",
  /**
   * One code for every invitation failure: unknown token, expired, revoked,
   * already used, or addressed to a different person. Distinguishing them
   * would turn the accept endpoint into an oracle for enumerating tokens and
   * discovering who was invited where.
   */
  "INVITATION_INVALID",
  /** Organisation slug is already taken. */
  "ORG_SLUG_TAKEN",
  /** The signed-in user has not confirmed their email address yet. */
  "EMAIL_NOT_VERIFIED",
  /**
   * The submitted request was rendered against a different active organisation
   * than the one now resolved, because the workspace was switched in another
   * tab. Refused rather than silently written to the wrong tenant.
   */
  "STALE_ORG_CONTEXT",
  /** Origin check or double-submit token failed on a state-changing request. */
  "CSRF_INVALID",
  /** Input failed Zod validation. */
  "VALIDATION_FAILED",

  /**
   * P2 additions (agents). As above, added explicitly rather than folded into
   * an existing code (CLAUDE.md rule 14); API_CONTRACT.md is updated in the
   * same change.
   *
   * There is deliberately no AGENT_NOT_FOUND. An unknown agent id and an agent
   * belonging to another organisation both answer ORG_ACCESS_DENIED, so the
   * endpoint cannot be used to confirm that a given agent exists.
   */
  /** The agent is archived; it cannot be published or edited until restored. */
  "AGENT_ARCHIVED",
  /** The draft configuration is empty or does not satisfy the agent schema. */
  "AGENT_CONFIG_INVALID",
  /**
   * An attempt to modify a version that has already been published. Published
   * versions are the record of what ran; a new version is published instead.
   */
  "AGENT_VERSION_IMMUTABLE",
  /**
   * The template does not exist, is not published, or its template is draft or
   * retired. One code for all four, so the install endpoint cannot be used to
   * discover templates the platform has not released.
   */
  "TEMPLATE_NOT_AVAILABLE",

  /**
   * P6. The organisation is suspended from new runs. Distinct from
   * ORG_ACCESS_DENIED because it is something the customer can act on: the
   * reason is on their own organisation row and shown on every page.
   */
  "ORG_SUSPENDED",

  /**
   * The database schema this deployment needs is not installed. Distinct from
   * every other failure because retrying cannot help and the person who sees
   * it is usually the person who can fix it.
   *
   * PostgREST answers PGRST205 for a missing table and PGRST202 for a missing
   * function. Both used to fall through to a generic "something went wrong,
   * try again", which is advice that can never work.
   */
  "DATABASE_NOT_PROVISIONED",
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
