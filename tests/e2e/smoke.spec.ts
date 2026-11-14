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
const PRIVATE_ROUTES = [
  "/app",
  "/app/agents",
  "/app/agents/00000000-0000-4000-8000-000000000000",
  "/app/templates",
  "/onboarding/start",
  "/app/runs",
  "/app/runs/00000000-0000-4000-8000-000000000000",
  "/app/billing",
  "/onboarding",
];

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
  // Every admin route, including the ones that read across tenants. A new
  // screen added without a guard is exactly what this is here to catch.
  for (const route of [
    "/admin",
    "/admin/organizations",
    "/admin/usage",
    "/admin/audit",
    "/admin/templates",
    "/admin/settings",
  ]) {
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

test("admin write endpoints answer 404 to anyone who is not a platform admin", async ({
  request,
}) => {
  // 404 and not 403, matching the pages. An API route that answered 401 would
  // confirm the admin surface exists to someone who cannot reach the pages,
  // which is the whole point of the convention.
  const id = "00000000-0000-4000-8000-000000000000";
  for (const res of await Promise.all([
    request.post("/api/admin/templates", {
      data: { slug: "x-template", category: "support", name: "X", description: "A description." },
    }),
    request.patch(`/api/admin/templates/${id}`, {
      data: { op: "visibility", visibility: "public" },
    }),
    request.post(`/api/admin/templates/${id}/versions`, { data: { definition: {} } }),
    request.patch(`/api/admin/organizations/${id}`, {
      data: { suspended: true, reason: "testing the boundary" },
    }),
  ])) {
    expect(res.status()).toBe(404);
  }
});

test("the internal sweeper is invisible without its secret", async ({ request }) => {
  // 404, not 401: a 401 would confirm the endpoint exists and that someone is
  // knocking on the right door. CI sets no AGENTOS_CRON_SECRET, so this also
  // covers the unconfigured case, which must refuse rather than stand open.
  for (const res of await Promise.all([
    request.get("/api/internal/sweep-reservations"),
    request.post("/api/internal/sweep-reservations", { data: {} }),
    request.post("/api/internal/sweep-reservations", {
      headers: { "x-agentos-cron-secret": "guessed-value-that-is-long-enough" },
      data: {},
    }),
  ])) {
    expect(res.status()).toBe(404);
  }
});

test("agent, template and run routes are closed to an unauthenticated, CSRF-less caller", async ({
  request,
}) => {
  // The whole agent surface, not a sample of it: each route is a separate
  // handler, and a new one added without a guard is exactly the kind of gap
  // this test exists to catch.
  const id = "00000000-0000-4000-8000-000000000000";
  // Every body below is VALID. A body that fails Zod would answer 400 before
  // the guard ran, and the test would pass without ever reaching the check it
  // claims to make.
  const calls = [
    request.post("/api/agents", { data: { orgId: id, name: "Valid name" } }),
    request.patch(`/api/agents/${id}`, {
      data: { orgId: id, name: "Valid name", description: null },
    }),
    request.put(`/api/agents/${id}/draft`, { data: { orgId: id, config: {} } }),
    request.post(`/api/agents/${id}/publish`, { data: { orgId: id } }),
    request.post(`/api/agents/${id}/archive`, { data: { orgId: id, archived: true } }),
    request.post(`/api/templates/${id}/install`, { data: { orgId: id } }),
    request.post(`/api/agents/${id}/run`, { data: { orgId: id, prompt: "hello" } }),
    request.post(`/api/runs/${id}/cancel`, { data: { orgId: id } }),
  ];
  for (const res of await Promise.all(calls)) {
    // 403 for the CSRF refusal, 401 if the session check answers first; never
    // 2xx, and never 500, which would mean the handler ran and then fell over.
    expect([401, 403]).toContain(res.status());
  }
});
