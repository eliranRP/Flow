import { expect, test } from "@playwright/test";

// FLOW-323 and FLOW-402 (decision 0144). The dev build lists invented lines from
// src/dev/search-e2e-fixture.ts in preview, so no server is needed.
test.use({ viewport: { width: 390, height: 700 } });

test("search opens from Home, finds a line, opens it, and Back keeps the search", async ({ page }) => {
  await page.goto("/e2e/home?preview=1");
  await page.getByRole("link", { name: "חיפוש תנועות" }).click();
  await expect(page).toHaveURL(/\/search\?preview=1$/);
  const field = page.getByRole("searchbox", { name: "חיפוש תנועות" });
  // The icon opened the screen, so the field takes focus.
  await expect(field).toBeFocused();
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toBeVisible();

  await field.fill("ספק 3");
  const row = page.getByRole("link", { name: /^ספק 3(?!\d)/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toHaveCount(0);
  await expect(row.locator("mark")).toHaveText("ספק 3");
  await expect(page.locator(".ui-search-count")).toContainText("תנועה אחת");

  await row.click();
  await expect(page).toHaveURL(/\/transactions\/t-step-3\?preview=1$/);
  await expect(page.getByText("ספק 3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/search\?preview=1$/);
  await expect(field).toHaveValue("ספק 3");
  await expect(row).toBeVisible();
  // Back is not a fresh visit: the keyboard stays down.
  await expect(field).not.toBeFocused();

  await page.getByRole("button", { name: "ניקוי", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toBeVisible();
});

test("search opens from the Projects header", async ({ page }) => {
  await page.goto("/e2e/projects?preview=1");
  await page.getByRole("link", { name: "חיפוש תנועות" }).click();
  await expect(page).toHaveURL(/\/search\?preview=1$/);
  await expect(page.getByRole("searchbox", { name: "חיפוש תנועות" })).toBeFocused();
});

test("a project's כל התנועות opens search with the project chip set", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("link", { name: "כל התנועות" }).click();
  await expect(page).toHaveURL(/\/search\?preview=1&project=p1$/);
  await expect(page.getByRole("button", { name: "שיפוץ הרצל 12" })).toHaveAttribute("aria-pressed", "true");
  // Only the project's lines; the other project's line is gone.
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^ספק 2(?!\d)/ })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "חיפוש תנועות" })).not.toBeFocused();
});
