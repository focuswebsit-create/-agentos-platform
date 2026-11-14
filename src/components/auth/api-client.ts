"use client";

import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";

/**
 * The single way client components talk to the API.
 *
 * Two jobs, both of which were being duplicated and getting subtly wrong:
 *
 *  1. Attach the double-submit CSRF token. Six components read the cookie
 *     themselves; one copy drifting is one endpoint silently unprotected.
 *  2. Never throw. A bare `await fetch()` rejects on a dropped connection, and
 *     an unhandled rejection inside an event handler or effect takes the React
 *     tree down — the user sees "this page couldn't load" instead of an error
 *     they can act on. This returns a result object instead.
 */

export function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; code: string | null; status: number };

/** `status: 0` means the request never reached the server. */
export const NETWORK_ERROR_STATUS = 0;

export async function sendJson<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", [CSRF_HEADER]: readCsrfToken() },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: null, status: NETWORK_ERROR_STATUS };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A body that is absent or not JSON is not itself an error; the status
    // still decides.
  }

  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && "code" in payload
        ? String((payload as { code: unknown }).code)
        : null;
    return { ok: false, code, status: response.status };
  }

  return { ok: true, data: payload as T };
}
