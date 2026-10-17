import { expect, test } from "@playwright/test";

// FLOW-140c1 (board Profit and ProfitBasis): Home's רווח row opens the company profit page; its
// category rows open in place, its chips set ?by=, its project row opens the project's profit, and the
// basis line opens the basis sheet. Invented data only, in preview.
test.use({ viewport: { width: 390, height: 844 } });

test("Home's profit row opens the company profit page, and Back returns Home", async ({ page }) => {
  await page.goto("/e2e/cash?preview=1");
  await page.getByRole("button", { name: /^רווח החודש/ }).click();
  await expect(page).toHaveURL(/\/profit\?preview=1$/);
  await expect(page.getByRole("heading", { name: "רווח", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(page).toHaveURL(/\/e2e\/cash\?preview=1$/);
});

test("the chips sort the page, a category opens in place, and a project opens its profit", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  const chips = page.getByRole("group", { name: "סידור" }).first();
  await chips.getByRole("button", { name: "לפי קטגוריה" }).click();
  await expect(page).toHaveURL(/\?preview=1&by=category$/);
  const category = page.locator(".ui-cp-list .ui-cp-row > button").first();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await chips.getByRole("button", { name: "לפי פרויקט" }).click();
  await expect(page).toHaveURL(/\/e2e\/company-profit\?preview=1$/);
  await page.locator('a[href^="/projects/"]').first().click();
  await expect(page).toHaveURL(/\/projects\/p\d\/profit\?from=profit&preview=1$/);
});

test("the basis line opens the basis sheet; a pick in preview toasts and writes nothing", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  await page.getByRole("button", { name: /נספר לפי תאריך תשלום · שינוי/ }).click();
  const sheet = page.getByRole("dialog", { name: "רווח ותזרים לפי" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: /תאריך חשבונית/ }).click();
  await expect(page.getByText("במצב תצוגה זה לא נשמר.")).toBeVisible();
  // The pick does not save here: the sheet stays open.
  await expect(sheet).toBeVisible();
});
