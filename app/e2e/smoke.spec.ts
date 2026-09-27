import { expect, test } from "@playwright/test";

test("preview home is the empty state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.getByText("כאן יופיע הרווח הנקי של העסק")).toBeVisible();
  await expect(page.getByText("עוד אין נתונים")).toBeVisible();
  await expect(page.getByText("נתוני דוגמה · Example data")).toBeVisible();
  await expect(page.getByRole("link", { name: "לאישור" })).toBeVisible();
  await expect(page.getByText("₪0")).toHaveCount(0);
});

test("signed-out home redirects to sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "המשך עם Google" })).toBeDisabled();
});
