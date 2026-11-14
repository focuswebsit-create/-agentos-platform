// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { NETWORK_ERROR_STATUS, readCsrfToken, sendJson } from "@/components/auth/api-client";

/**
 * The client API wrapper is security-relevant: it is the single place the CSRF
 * token is attached. A regression here silently unprotects every mutation, so
 * it is tested rather than assumed.
 */

function setCookie(value: string) {
  document.cookie = `${CSRF_COOKIE}=${value}; path=/`;
}
function clearCookie() {
  document.cookie = `${CSRF_COOKIE}=; path=/; max-age=0`;
}

beforeEach(() => clearCookie());
afterEach(() => {
  vi.unstubAllGlobals();
  clearCookie();
});

describe("readCsrfToken", () => {
  it("reads the token and url-decodes it", () => {
    setCookie(encodeURIComponent("abc+def/ghi"));
    expect(readCsrfToken()).toBe("abc+def/ghi");
  });

  it("returns an empty string when the cookie is absent, rather than throwing", () => {
    expect(readCsrfToken()).toBe("");
  });

  it("is not fooled by a different cookie whose name ends the same way", () => {
    document.cookie = `not_${CSRF_COOKIE}=wrong; path=/`;
    expect(readCsrfToken()).toBe("");
  });
});

describe("sendJson", () => {
  it("attaches the CSRF token header on every request", async () => {
    setCookie("tok123");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendJson("/api/x", "POST", { a: 1 });

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const init = call![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers[CSRF_HEADER]).toBe("tok123");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("returns a result instead of throwing when the connection drops", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    // An unhandled rejection here would take the React tree down and show the
    // browser's "page couldn't load" screen instead of an error the user can act on.
    const res = await sendJson("/api/x", "POST", {});
    expect(res).toEqual({ ok: false, code: null, status: NETWORK_ERROR_STATUS });
  });

  it("surfaces the server's problem code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: "SEAT_LIMIT_REACHED" }), { status: 409 }),
        ),
    );
    const res = await sendJson("/api/x", "POST", {});
    expect(res).toEqual({ ok: false, code: "SEAT_LIMIT_REACHED", status: 409 });
  });

  it("handles an error response with no JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const res = await sendJson("/api/x", "POST", {});
    expect(res).toEqual({ ok: false, code: null, status: 500 });
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ orgId: "x" }), { status: 201 })),
    );
    const res = await sendJson<{ orgId: string }>("/api/x", "POST", {});
    expect(res).toEqual({ ok: true, data: { orgId: "x" } });
  });
});
