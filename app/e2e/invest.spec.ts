import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

// FLOW-446: the project's ⋯ menu opens the investment page; a figure opens its sheet; Back returns.
test("the menu opens the investment page, the ARV row opens its sheet, Back returns to the project", async ({ page }) => {
  await page.goto("/e2e/project-detail?preview=1");
  await page.getByRole("button", { name: "עוד" }).click();
  await page.getByRole("link", { name: /^השקעה והלוואות/ }).click();
  await expect(page).toHaveURL(/\/e2e\/project-investment/);
  await expect(page.getByRole("heading", { name: "השקעה והלוואות" })).toBeVisible();
  await page.getByRole("button", { name: /^שווי אחרי שיפוץ/ }).click();
  const dialog = page.getByRole("dialog", { name: "שווי אחרי שיפוץ (ARV)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "שמירה" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /^חזרה/ }).first().click();
  await expect(page).toHaveURL(/\/e2e\/project-detail/);
});
