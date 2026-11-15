import { allowedOrigins } from "@/modules/tenancy/csrf";
import type { ChatError } from "@/modules/runtime/chat";

/**
 * Shared rules for the public chat endpoints.
 *
 * They carry no session, so there is no ambient authority to forge and CSRF
 * tokens do not apply. What they do check: the browser Origin must be our own
 * (the hosted chat page), so another website's script cannot drive the API
 * from a visitor's browser. Non-browser clients can omit Origin entirely,
 * which is why the database-side rate limits - not this check - are the abuse
 * control.
 */
export const KEY_PATTERN = /^wk_[A-Za-z0-9_-]{20,64}$/;

export function sameOriginOrNone(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || allowedOrigins(request).includes(origin);
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null;
}

const STATUS: Record<ChatError, number> = {
  NOT_CONFIGURED: 503,
  WIDGET_NOT_AVAILABLE: 404,
  CONVERSATION_NOT_FOUND: 404,
  CONVERSATION_CLOSED: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

export function chatError(error: ChatError): Response {
  return Response.json(
    { error },
    { status: STATUS[error], headers: { "cache-control": "no-store" } },
  );
}
