import { expect, test } from "@playwright/test";

const PUBLIC_AND_APP_ROUTES = [
  "/",
  "/pricing",
  "/app",
  "/app/agents",
  "/app/agents/studio",
  "/app/runs",
  "/app/billing",
];

test.describe("routes render in Hebrew RTL", () => {
  for (const route of PUBLIC_AND_APP_ROUTES) {
    test(`${route} → 200, lang=he, dir=rtl`, async ({ page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("html")).toHaveAttribute("lang", "he");
      await expect(page.locator("main#main")).toBeVisible();
    });
  }
});

test.describe("mobile 375px has no horizontal overflow", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const route of PUBLIC_AND_APP_ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("mobile app drawer opens and navigates", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "פתיחת תפריט" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: "הרצות" }).click();
    await expect(page).toHaveURL(/\/app\/runs$/);
  });
});

test("Super Admin is hidden (404) for anyone who is not a platform admin", async ({ page }) => {
  for (const route of ["/admin", "/admin/organizations", "/admin/settings"]) {
    const res = await page.goto(route);
    expect(res?.status(), route).toBe(404);
    await expect(page.getByText("Super Admin")).toHaveCount(0);
  }
});

test("pricing shows planned prices and no active checkout", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("הסליקה אינה פעילה", { exact: false })).toBeVisible();
  const buy = page.getByRole("button", { name: "הרכישה אינה זמינה עדיין" });
  await expect(buy).toHaveCount(3);
  for (const b of await buy.all()) await expect(b).toBeDisabled();
});

test("Agent Studio cannot run, save or publish", async ({ page }) => {
  await page.goto("/app/agents/studio");
  await expect(page.getByTestId("studio-run")).toBeDisabled();
  await expect(page.getByRole("button", { name: "שמירת טיוטה" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "פרסום גרסה" })).toBeDisabled();
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
