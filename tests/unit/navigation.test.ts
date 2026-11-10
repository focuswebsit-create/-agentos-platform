// @vitest-environment node
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/components/admin-shell/admin-nav-config";
import { APP_NAV, isActivePath } from "@/components/app-shell/nav-config";
import { getDictionary } from "@/i18n";

const APP_DIR = path.resolve(import.meta.dirname, "../../src/app");

function pageFileFor(href: string) {
  return path.join(APP_DIR, ...href.split("/").filter(Boolean), "page.tsx");
}

describe("customer sidebar", () => {
  it("contains every section required by UI_UX_SPEC.md", () => {
    expect(APP_NAV.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        "dashboard",
        "agents",
        "teams",
        "workflows",
        "templates",
        "runs",
        "knowledge",
        "integrations",
        "approvals",
        "analytics",
        "billing",
        "team",
        "settings",
      ]),
    );
  });

  it.each(APP_NAV.map((i) => [i.href]))("%s has a page", (href) => {
    expect(existsSync(pageFileFor(href))).toBe(true);
  });

  it("every item has a label and every non-dashboard item has a planned phase", () => {
    const t = getDictionary();
    for (const item of APP_NAV) {
      expect(t.app.nav[item.key]).toBeTruthy();
      if (item.key !== "dashboard") expect(item.phase).not.toBeNull();
    }
  });

  it("only routes under /app", () => {
    for (const item of APP_NAV) expect(item.href.startsWith("/app")).toBe(true);
  });

  it("computes active state", () => {
    expect(isActivePath("/app", "/app")).toBe(true);
    expect(isActivePath("/app/agents", "/app")).toBe(false);
    expect(isActivePath("/app/agents/studio", "/app/agents")).toBe(true);
    expect(isActivePath("/app/agentsx", "/app/agents")).toBe(false);
  });
});

describe("super admin sidebar", () => {
  it.each(ADMIN_NAV.map((i) => [i.href]))("%s has a page", (href) => {
    expect(existsSync(pageFileFor(href))).toBe(true);
  });

  it("is a separate boundary that never links into /app", () => {
    for (const item of ADMIN_NAV) expect(item.href.startsWith("/admin")).toBe(true);
  });

  it("covers customers, subscriptions, usage, costs, settings and alerts", () => {
    expect(ADMIN_NAV.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        "organizations",
        "subscriptions",
        "usage",
        "costs",
        "settings",
        "alerts",
      ]),
    );
  });
});
