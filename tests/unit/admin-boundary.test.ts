// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { parseServerEnv, getSiteUrl } from "@/config/env";

/**
 * The request-level auth boundary (src/proxy.ts).
 *
 * P0 hid /admin behind the ADMIN_SHELL_PREVIEW environment variable because
 * there was no authentication. P1 replaces that with a session check here and
 * a real platform-admin check (platform_admins row + AAL2) in the /admin
 * layout, so these tests were rewritten rather than removed.
 *
 * updateSession is mocked: this file is about the proxy's routing decisions,
 * not about Supabase. Whether a session is genuine is proven elsewhere.
 */

const mocks = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock("@/modules/supabase/proxy-session", () => ({
  updateSession: mocks.updateSession,
  // The real one copies refreshed cookies onto the outgoing response; for
  // routing assertions the identity function is enough.
  carryAuthCookies: (_from: NextResponse, to: NextResponse) => to,
}));

const { config, proxy } = await import("@/proxy");

function signedOut() {
  mocks.updateSession.mockImplementation(async (request: NextRequest) => {
    const { NextResponse } = await import("next/server");
    return { response: NextResponse.next({ request }), userId: null };
  });
}

function signedIn(userId = "11111111-1111-4111-8111-111111111111") {
  mocks.updateSession.mockImplementation(async (request: NextRequest) => {
    const { NextResponse } = await import("next/server");
    return { response: NextResponse.next({ request }), userId };
  });
}

beforeEach(() => {
  mocks.updateSession.mockReset();
});

describe("proxy matcher", () => {
  it("covers the customer app, the admin surface and the invitation path", () => {
    expect(config.matcher).toContain("/app");
    expect(config.matcher).toContain("/app/:path*");
    expect(config.matcher).toContain("/admin");
    expect(config.matcher).toContain("/admin/:path*");
    expect(config.matcher).toContain("/invite/:path*");
  });

  it("does not run on marketing routes", () => {
    expect(config.matcher).not.toContain("/");
    expect(config.matcher).not.toContain("/pricing");
  });
});

describe("/admin boundary", () => {
  it("answers 404 — not 403 — when signed out, so the surface is not confirmed", async () => {
    signedOut();
    const res = await proxy(new NextRequest("http://localhost/admin"));
    expect(res.status).toBe(404);
  });

  it("answers 404 for sub-paths too", async () => {
    signedOut();
    const res = await proxy(new NextRequest("http://localhost/admin/organizations"));
    expect(res.status).toBe(404);
  });

  it("lets a signed-in request through to the layout, with noindex and no-store", async () => {
    signedIn();
    const res = await proxy(new NextRequest("http://localhost/admin"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a session alone is NOT authorization: the layout still runs requirePlatformAdmin", async () => {
    // Documents the split deliberately. The proxy cannot read platform_admins
    // without the service-role key, so it only proves "someone is signed in".
    signedIn();
    const res = await proxy(new NextRequest("http://localhost/admin"));
    expect(res.status).toBe(200);
  });
});

describe("/app boundary", () => {
  it("redirects a signed-out request to sign-in", async () => {
    signedOut();
    const res = await proxy(new NextRequest("http://localhost/app"));
    expect([302, 307]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
  });

  it("preserves where the user was going", async () => {
    signedOut();
    const res = await proxy(new NextRequest("http://localhost/app/team?tab=invites"));
    const location = new URL(res.headers.get("location") ?? "", "http://localhost");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/app/team?tab=invites");
  });

  it("the return path is always same-origin relative, never an absolute URL", async () => {
    signedOut();
    const res = await proxy(new NextRequest("http://localhost/app/agents"));
    const next = new URL(res.headers.get("location") ?? "", "http://localhost").searchParams.get(
      "next",
    );
    expect(next).toMatch(/^\//);
    expect(next).not.toMatch(/^\/\//);
    expect(next).not.toMatch(/^https?:/);
  });

  it("serves a signed-in request and forbids caching it", async () => {
    signedIn();
    const res = await proxy(new NextRequest("http://localhost/app"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("server env", () => {
  it("drops an unparseable site URL instead of passing it on", () => {
    expect(
      parseServerEnv({ NEXT_PUBLIC_SITE_URL: "not a url" }).NEXT_PUBLIC_SITE_URL,
    ).toBeUndefined();
    expect(getSiteUrl({})).toBeUndefined();
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.test" })).toBe(
      "https://example.test",
    );
  });
});
