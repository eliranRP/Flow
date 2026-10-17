import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("joining from the invitation opens the joined state, and פתיחת goes Home", async ({ page }) => {
  await page.goto("/e2e/invites?state=viewer");
  await expect(page.getByRole("heading", { name: "נכסי הגפן בע״מ" })).toBeVisible();
  // The invitation is full screen: no tab bar.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByRole("button", { name: "הצטרפות כצופה" }).click();
  await expect(page.getByRole("heading", { name: "הצטרפת ל־נכסי הגפן בע״מ" })).toBeVisible();
  await page.getByRole("button", { name: "פתיחת נכסי הגפן בע״מ" }).click();
  await expect(page).not.toHaveURL(/\/e2e\/invites/);
});

test("אחר כך leaves the invite waiting, and the switch sheet lists it", async ({ page }) => {
  await page.goto("/e2e/invites?state=viewer");
  await page.getByRole("link", { name: "אחר כך" }).click();
  await page.goto("/e2e/settings?board=1&sheet=switch");
  const sheet = page.getByRole("dialog", { name: "העסקים שלך" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "הזמנות" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "הצטרפות לנכסי הגפן בע״מ" })).toBeVisible();
});
