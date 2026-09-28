import { expect, test } from "@playwright/test";

test("component gallery is outside the tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/components");
  await expect(page.getByRole("heading", { name: "ספריית הרכיבים" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeVisible();
  await expect(page.getByRole("button", { name: "מחיקה" }).first()).toBeVisible();
});
