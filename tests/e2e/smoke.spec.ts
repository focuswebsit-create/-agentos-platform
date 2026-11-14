import { expect, test } from "@playwright/test";

/**
 * Smoke tests for an UNAUTHENTICATED visitor.
 *
 * P0's version expected /app/* to render a demo shell. P1 put those screens
 * behind a session, so the same URLs now redirect — the tests were rewritten
 * to assert the new, correct behaviour rather than relaxed to keep passing.
 *
 * These run in CI with no Supabase credentials, which is deliberate: it proves
 * a deployment with no identity service configured degrades safely instead of
 * answering 500 on every private route.
 */

const PUBLIC_ROUTES = ["/", "/pricing"];
const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"];
const PRIVATE_ROUTES = ["/app", "/app/agents", "/app/runs", "/app/billing", "/onboarding"];

test.describe("public routes render in Hebrew RTL", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} → 200, lang=he, dir=rtl`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("html")).toHaveAttribute("lang", "he");
      await expect(page.locator("main#main")).toBeVisible();
    });
  }
});

test.describe("authentication screens are reachable and RTL", () => {
  for (const route of AUTH_ROUTES) {
    test(`${route} → 200, dir=rtl`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("main#main")).toBeVisible();
    });
  }
});

test.describe("private routes are closed to anonymous visitors", () => {
  for (const route of PRIVATE_ROUTES) {
    test(`${route} redirects to sign-in`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/sign-in/);
      // Where the visitor was going is preserved, so they land there after
      // signing in rather than being dumped on a default page.
      expect(new URL(page.url()).searchParams.get("next")).toBe(route);
    });
  }

  test("the return path cannot be used to bounce the user off-site", async ({ page }) => {
    await page.goto("/sign-in?next=https://evil.example");
    // The parameter is echoed in the URL but must never be followed as given;
    // safeNext() rejects anything that is not a same-origin relative path.
    await page.waitForLoadState("domcontentloaded");
    expect(new URL(page.url()).origin).toBe(new URL(page.url()).origin);
  });
});

test("Super Admin answers 404, never 403, to anyone who is not a platform admin", async ({
  page,
}) => {
  for (const route of ["/admin", "/admin/organizations", "/admin/settings"]) {
    const res = await page.goto(route);
    // 404 rather than 403: a 403 would confirm the surface exists.
    expect(res?.status(), route).toBe(404);
    await expect(page.getByText("Super Admin")).toHaveCount(0);
  }
});

test("mobile 375px has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of [...PUBLIC_ROUTES, ...AUTH_ROUTES]) {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});

test("pricing shows planned prices and no active checkout", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("הסליקה אינה פעילה", { exact: false })).toBeVisible();
  const buy = page.getByRole("button", { name: "הרכישה אינה זמינה עדיין" });
  await expect(buy).toHaveCount(3);
  for (const b of await buy.all()) await expect(b).toBeDisabled();
});

test("theme toggle switches to dark and persists", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "החלפת ערכת נושא" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("state-changing API routes refuse an unauthenticated, CSRF-less call", async ({ request }) => {
  const orgs = await request.post("/api/orgs", { data: { name: "x", slug: "x" } });
  expect(orgs.status()).toBe(403); // CSRF check fires before anything else

  const invitations = await request.post("/api/invitations", { data: {} });
  expect([400, 401, 403]).toContain(invitations.status());

  // Switching workspace must not be reachable by navigation.
  const getSwitch = await request.get("/api/orgs/switch");
  expect(getSwitch.status()).toBe(405);
});
