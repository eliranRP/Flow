import { expect, test } from "@playwright/test";

const pages: Array<[string, string]> = [
  ["/", "כאן יופיע הרווח הנקי של העסק"],
  ["/projects", "פרויקטים"],
  ["/projects/herzl", "פרויקט"],
  ["/review", "לאישור"],
  ["/unpaid", "חשבוניות פתוחות"],
  ["/settings", "הגדרות"],
  ["/settings/categories", "קטגוריות"],
  ["/onboarding", "פרטי העסק"],
  ["/notifications", "התראות"],
  ["/transactions/1", "פרטי תנועה"],
  ["/transactions/1/split", "פיצול"],
];

for (const [path, heading] of pages) {
  test(`preview ${path} shows ${heading} without fixture amounts`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const joiner = path.includes("?") ? "&" : "?";
    await page.goto(`${path}${joiner}preview=1`);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
    await expect(page.getByText("76,300")).toHaveCount(0);
    await expect(page.getByText("37,700")).toHaveCount(0);
  });
}

test("add sheet is a title until income and expense can be entered", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add?preview=1");
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  await expect(page.getByText("בקרוב תוכלו להוסיף כאן הכנסה או הוצאה")).toBeVisible();
});

test("a failed load is not an empty or missing record", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/unpaid?preview=error");
  await expect(page.getByRole("button", { name: "ניסיון חוזר" })).toBeVisible();
  await expect(page.getByText("הכל שולם")).toHaveCount(0);
  await page.goto("/projects/missing?preview=error");
  await expect(page.getByRole("button", { name: "ניסיון חוזר" })).toBeVisible();
  await expect(page.getByText("הפרויקט לא נמצא.")).toHaveCount(0);
  await page.goto("/review?preview=error");
  await expect(page.getByRole("button", { name: "ניסיון חוזר" })).toBeVisible();
  await expect(page.getByText("הכל מאושר")).toHaveCount(0);
});

test("preview home has no fixture profit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeVisible();
  await expect(page.getByText("37,700")).toHaveCount(0);
  await expect(page.getByText("76,300")).toHaveCount(0);
});
