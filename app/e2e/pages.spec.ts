import { expect, test } from "@playwright/test";

const pages: Array<[string, string]> = [
  ["/", "76,300"],
  ["/projects", "פרויקטים"],
  ["/projects/herzl", "שיפוץ הרצל 12"],
  ["/review", "לאישור"],
  ["/unpaid", "חשבוניות פתוחות"],
  ["/settings", "הגדרות"],
  ["/settings/categories", "קטגוריות"],
  ["/onboarding", "פרטי העסק"],
  ["/notifications", "התראות"],
  ["/transactions/H-INV-A", "פרטי תנועה"],
  ["/transactions/H-INV-A/split", "פיצול"],
];

for (const [path, heading] of pages) {
  test(`demo ${path} shows ${heading}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const joiner = path.includes("?") ? "&" : "?";
    await page.goto(`${path}${joiner}preview=demo`);
    await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
  });
}

test("demo add sheet has income and expense", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add?preview=demo");
  await expect(page.getByRole("dialog", { name: "הוספה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "הוצאה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "הכנסה" })).toBeVisible();
});

test("demo home shows the golden cash loss and opens the period sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=demo");
  await expect(page.getByRole("heading", { name: /76,300/ })).toBeVisible();
  await page.getByRole("button", { name: "כל התקופה" }).click();
  await expect(page.getByRole("dialog", { name: "תקופה" })).toBeVisible();
  await page.getByRole("button", { name: "חשבוניות" }).click();
  await expect(page.getByRole("heading", { name: /37,700/ })).toBeVisible();
});
