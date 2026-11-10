// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isAdminShellPreviewEnabled, parseServerEnv } from "@/config/env";
import { config, proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ADMIN_SHELL_PREVIEW flag", () => {
  it("is off by default and fails closed on invalid values", () => {
    expect(isAdminShellPreviewEnabled({})).toBe(false);
    expect(isAdminShellPreviewEnabled({ ADMIN_SHELL_PREVIEW: "false" })).toBe(false);
    expect(isAdminShellPreviewEnabled({ ADMIN_SHELL_PREVIEW: "1" })).toBe(false);
    expect(isAdminShellPreviewEnabled({ ADMIN_SHELL_PREVIEW: "TRUE" })).toBe(false);
    expect(isAdminShellPreviewEnabled({ ADMIN_SHELL_PREVIEW: "true" })).toBe(true);
  });

  it("an invalid site URL does not enable the admin shell", () => {
    expect(
      parseServerEnv({ ADMIN_SHELL_PREVIEW: "true", NEXT_PUBLIC_SITE_URL: "not a url" })
        .ADMIN_SHELL_PREVIEW,
    ).toBe(false);
  });
});

describe("proxy: /admin boundary", () => {
  it("matches /admin and all sub-paths only", () => {
    expect(config.matcher).toEqual(["/admin", "/admin/:path*"]);
  });

  it("returns 404 for /admin when the preview flag is off", () => {
    vi.stubEnv("ADMIN_SHELL_PREVIEW", "false");
    const res = proxy(new NextRequest("http://localhost/admin/organizations"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the flag is unset", () => {
    vi.stubEnv("ADMIN_SHELL_PREVIEW", "");
    expect(proxy(new NextRequest("http://localhost/admin")).status).toBe(404);
  });

  it("passes through with noindex + no-store when the dev preview is enabled", () => {
    vi.stubEnv("ADMIN_SHELL_PREVIEW", "true");
    const res = proxy(new NextRequest("http://localhost/admin"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
