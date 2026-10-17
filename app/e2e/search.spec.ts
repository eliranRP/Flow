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
  // The start shows the last searches and the three checks, not the lines (FLOW-368).
  await expect(page.getByRole("heading", { name: "שווה לבדוק" })).toBeVisible();
  await expect(page.getByRole("button", { name: /ממתינים לאישור/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toHaveCount(0);

  await field.fill("ספק 3");
  const row = page.getByRole("link", { name: /^ספק 3(?!\d)/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toHaveCount(0);
  await expect(row).toContainText("ספק 3");
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
  await expect(page.getByRole("heading", { name: "שווה לבדוק" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toHaveCount(0);
});

test("Projects has no search field; its unassigned link opens review", async ({ page }) => {
  await page.goto("/e2e/projects?preview=1");
  // FLOW-342 (A): no header magnifier on Projects.
  await expect(page.getByRole("link", { name: "חיפוש תנועות" })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "חיפוש פרויקט" })).toHaveCount(0);
  await page.getByRole("link", { name: /^שורה אחת בלי פרויקט/ }).click();
  await expect(page).toHaveURL(/\/review/);
});

test("a project's כל התנועות opens search with the project chip set", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1&section=transactions");
  await page.getByRole("link", { name: "כל התנועות" }).click();
  await expect(page).toHaveURL(/\/search\?preview=1&project=p1$/);
  // The project shows as a removable chip under the field (FLOW-368).
  await expect(page.getByRole("button", { name: "הסרת שיפוץ הרצל 12" })).toBeVisible();
  // The sheet's project chip is a toggle and is pressed.
  await page.getByRole("button", { name: /^סינון/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "שיפוץ הרצל 12", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  // Only the project's lines; the other project's line is gone.
  await expect(page.getByRole("link", { name: /^ספק 1(?!\d)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^ספק 2(?!\d)/ })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "חיפוש תנועות" })).not.toBeFocused();
});
