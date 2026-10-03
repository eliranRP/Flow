import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function backTo(page: Page, name: string) {
  await page.getByRole("button", { name }).click();
}

test("an expense opened from a project returns to that project", async ({ page }) => {
  await page.goto("/e2e/project");
  await page.getByRole("link", { name: "הוצאה לבדיקה" }).click();
  await expect(page.getByRole("heading", { name: "הוצאה לבדיקה" })).toBeVisible();
  await backTo(page, "חזרה");
  await expect(page).toHaveURL(/\/e2e\/project$/);
  await expect(page.getByRole("heading", { name: "פרויקט לבדיקה" })).toBeVisible();
});

test("browser back matches the expense button", async ({ page }) => {
  await page.goto("/e2e/project");
  await page.getByRole("link", { name: "הוצאה לבדיקה" }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/project$/);
  await expect(page.getByRole("heading", { name: "פרויקט לבדיקה" })).toBeVisible();
});

test("a fresh expense falls back to the project list", async ({ page }) => {
  await page.goto("/e2e/expense");
  await backTo(page, "חזרה");
  await expect(page).toHaveURL(/\/projects\?preview=1$/);
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
});

test("scroll on the project is still there after the expense", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/e2e/project");
  const link = page.getByRole("link", { name: "הוצאה לבדיקה" });
  await link.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await link.click();
  await backTo(page, "חזרה");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});

test("each screen returns to where it was opened, and a fresh visit uses its parent", async ({ page }) => {
  const paths: Array<[string, string, string, RegExp]> = [
    ["פרויקט לדוגמה", "חזרה", "/projects/herzl?preview=1", /\/projects\?preview=1$/],
    ["תנועה לדוגמה", "חזרה", "/transactions/1?preview=1", /\/projects\?preview=1$/],
    ["פיצול לדוגמה", "חזרה", "/transactions/1/split?preview=1", /\/transactions\/1\?preview=1$/],
    ["קטגוריות לדוגמה", "חזרה", "/settings/categories?preview=1", /\/settings\?preview=1$/],
    ["התראות לדוגמה", "חזרה", "/notifications?preview=1", /\/settings\?preview=1$/],
    ["חשבוניות לדוגמה", "חזרה", "/unpaid?preview=1", /\/\?preview=1$/],
    ["הצטרפות לדוגמה", "חזרה", "/onboarding?preview=1", /\/sign-in\?preview=1$/],
    ["התקנה לדוגמה", "סגירה", "/install?preview=1", /\/settings\?preview=1$/],
    ["שינוי לדוגמה", "סגירה", "/review/change?preview=1", /\/review\?preview=1$/],
  ];
  for (const [label, control, fresh, parent] of paths) {
    await page.goto("/e2e/project");
    await page.getByRole("link", { name: label }).click();
    await backTo(page, control);
    await expect(page).toHaveURL(/\/e2e\/project$/);
    await page.goto(fresh);
    await backTo(page, control);
    await expect(page).toHaveURL(parent);
  }
});

test("the period sheet closes on browser back and on its own close", async ({ page }) => {
  await page.goto("/e2e/project");
  await page.goto("/?preview=loading");
  await page.getByRole("button", { name: "החודש" }).click();
  await expect(page.getByRole("dialog", { name: "תקופה" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/preview=loading/);
  await page.getByRole("button", { name: "החודש" }).click();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/project$/);
});

test("the connect sheet closes on browser back and on its own close", async ({ page }) => {
  await page.goto("/settings?preview=1");
  await page.getByRole("button", { name: "SUMIT", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "חיבור SUMIT" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
  await page.goto("/e2e/project");
  await page.goto("/settings?preview=1");
  await page.getByRole("button", { name: "SUMIT", exact: true }).click();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/project$/);
});

test("the add sheet closes back to the screen that opened it", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("link", { name: "הוספה" }).click();
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?preview=1$/);
  await page.getByRole("link", { name: "הוספה" }).click();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?preview=1$/);
});
