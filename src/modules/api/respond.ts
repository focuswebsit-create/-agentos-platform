import { NextResponse } from "next/server";
import type { ErrorCode } from "@/modules/contracts";

/**
 * The single response shape for every API route.
 *
 * API_CONTRACT.md requires `{code, message, requestId}` with a UUID requestId
 * on every error, so support can tie a user's screenshot to a server log line
 * without the user having to reproduce anything.
 */

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  MFA_REQUIRED: 403,
  ORG_ACCESS_DENIED: 403,
  CSRF_INVALID: 403,
  STALE_ORG_CONTEXT: 409,
  ORG_SLUG_TAKEN: 409,
  SEAT_LIMIT_REACHED: 409,
  INVITATION_INVALID: 400,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

export type ApiProblem = {
  code: ErrorCode;
  message: string;
  requestId: string;
};

export function problem(code: ErrorCode, message: string, requestId = newRequestId()) {
  const body: ApiProblem = { code, message, requestId };
  return NextResponse.json(body, { status: STATUS_BY_CODE[code] ?? 400 });
}

export function okJson<T>(data: T, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200 });
}

/**
 * Maps a PostgreSQL error raised by one of the migration RPCs onto a stable
 * API code.
 *
 * The database is the authority for these rules, so its error is translated
 * rather than second-guessed. Anything unrecognised becomes a generic failure:
 * a raw driver message can carry schema details and must never reach a client.
 */
export function mapDatabaseError(message: string | undefined): {
  code: ErrorCode;
  message: string;
} {
  const m = message ?? "";
  if (m.includes("SEAT_LIMIT_REACHED")) {
    return { code: "SEAT_LIMIT_REACHED", message: "לא נותרו מושבים פנויים בארגון." };
  }
  if (m.includes("USAGE_LIMIT_REACHED")) {
    return {
      code: "USAGE_LIMIT_REACHED",
      message: "הגעתם לתקרת ההוצאה החודשית של הארגון.",
    };
  }
  if (m.includes("ORG_SLUG_TAKEN") || m.includes("organizations_slug_unique")) {
    return { code: "ORG_SLUG_TAKEN", message: "המזהה הזה כבר תפוס. בחרו מזהה אחר." };
  }
  if (m.includes("EMAIL_NOT_VERIFIED")) {
    return { code: "EMAIL_NOT_VERIFIED", message: "יש לאמת את כתובת האימייל לפני ביצוע הפעולה." };
  }
  if (m.includes("INVITATION_INVALID")) {
    return { code: "INVITATION_INVALID", message: "ההזמנה אינה תקפה." };
  }
  if (m.includes("ORG_REQUIRES_OWNER")) {
    return { code: "ORG_ACCESS_DENIED", message: "לארגון חייב להישאר בעל אחד לפחות." };
  }
  // Before the insufficient_privilege catch-all below: AGENT_VERSION_IMMUTABLE
  // is raised with that errcode, and would otherwise be reported as a
  // permissions problem when it is in fact a rule nobody can be granted past.
  if (m.includes("AGENT_VERSION_IMMUTABLE")) {
    return {
      code: "AGENT_VERSION_IMMUTABLE",
      message: "גרסה שפורסמה אינה ניתנת לעריכה. פרסמו גרסה חדשה.",
    };
  }
  if (m.includes("AGENT_ARCHIVED")) {
    return { code: "AGENT_ARCHIVED", message: "הסוכן בארכיון. יש לשחזר אותו לפני פרסום." };
  }
  if (m.includes("AGENT_CONFIG_INVALID")) {
    return { code: "AGENT_CONFIG_INVALID", message: "הגדרות הסוכן חסרות או אינן תקינות." };
  }
  if (m.includes("TEMPLATE_NOT_AVAILABLE") || m.includes("TEMPLATE_VERSION_IMMUTABLE")) {
    return { code: "TEMPLATE_NOT_AVAILABLE", message: "התבנית אינה זמינה להתקנה." };
  }
  if (m.includes("AGENT_VERSION_MISSING")) {
    return { code: "AGENT_VERSION_MISSING", message: "לא נמצאה טיוטה לפרסום." };
  }
  if (m.includes("ORG_ACCESS_DENIED") || m.includes("insufficient_privilege")) {
    return { code: "ORG_ACCESS_DENIED", message: "אין לכם הרשאה לבצע את הפעולה הזו." };
  }
  if (m.includes("AUTH_REQUIRED")) {
    return { code: "AUTH_REQUIRED", message: "נדרשת התחברות." };
  }
  return { code: "VALIDATION_FAILED", message: "הפעולה נכשלה. נסו שוב." };
}
