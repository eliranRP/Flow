import { expect, test } from "@playwright/test";

test("safari fallback explains the installed app", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth/opened-in-safari");
  await expect(page.getByRole("heading", { name: "חזרו לאפליקציה Flow" })).toBeVisible();
});

test("demo add opens the hebrew date picker", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/add?preview=demo");
  await page.getByRole("button", { name: "בחירת תאריך" }).click();
  await expect(page.getByRole("dialog", { name: "תאריך" })).toBeVisible();
  await page.getByRole("button", { name: "היום" }).click();
  await expect(page.getByRole("dialog", { name: "תאריך" })).toHaveCount(0);
});

test("demo categories ask before hiding", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/categories?preview=demo");
  await page.getByRole("button", { name: "הסתרה" }).first().click();
  await expect(page.getByRole("dialog", { name: "הסתרת קטגוריה" })).toBeVisible();
});

test("demo settings offers the accountant export", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings?preview=demo");
  await expect(page.getByRole("button", { name: "ייצוא לרואה החשבון" })).toBeVisible();
  await page.getByRole("button", { name: "ייצוא לרואה החשבון" }).click();
  await expect(page.getByText("במצב תצוגה הקובץ לא יורד")).toBeVisible();
});

test("demo home can request a refresh and a custom range", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=demo");
  await page.getByRole("button", { name: "רענון" }).click();
  await expect(page.getByText("במצב תצוגה אין קריאה ל-SUMIT")).toBeVisible();
  await page.getByRole("button", { name: "כל התקופה" }).click();
  await expect(page.getByRole("button", { name: "הצגת הטווח" })).toBeVisible();
});

test("notifications explain the free push schedule", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notifications?preview=demo");
  await expect(page.getByText("Web Push עם מפתח VAPID")).toBeVisible();
  await expect(page.getByText("חסר מפתח VAPID")).toBeVisible();
});
