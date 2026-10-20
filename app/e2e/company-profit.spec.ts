import { expect, test } from "@playwright/test";

// FLOW-140c1 (board Profit and ProfitBasis): Home's רווח row opens the company profit page; its head
// has the summary rows, next month's card and the chart (FLOW-143); its category rows open in place,
// its chips set ?by=, its project row opens the project's profit, and the basis line opens the basis
// sheet. Invented data only, in preview.
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
  const categories = page.locator(".ui-pcat-button");
  const category = categories.first();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  // One category open at a time: opening another closes the first.
  await categories.nth(1).click();
  await expect(categories.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await categories.nth(1).click();
  await expect(categories.nth(1)).toHaveAttribute("aria-expanded", "false");
  await chips.getByRole("button", { name: "לפי פרויקט" }).click();
  await expect(page).toHaveURL(/\/e2e\/company-profit\?preview=1$/);
  await page.locator('a[href^="/projects/"]').first().click();
  await expect(page).toHaveURL(/\/projects\/p\d\/profit\?from=profit&preview=1$/);
});

test("the head: the summary rows, next month's card with no link, and the chart (FLOW-143)", async ({ page }) => {
  await page.goto("/e2e/company-profit?preview=1");
  const summary = page.locator(".ui-cp-card .ui-pp-label");
  await expect(summary).toHaveText(["הכנסות", "הוצאות שנספרות ברווח", "רווח אוקטובר", "רווח מתחילת השנה"]);
  // The bars and the loose year-to-date line are gone.
  await expect(page.locator(".ui-cp-head .ui-pp-bar")).toHaveCount(0);
  const card = page.locator(".ui-cp-head .ui-fc-card");
  await expect(card).toContainText("5 פרויקטים וכללי");
  await expect(card).toContainText("רווח צפוי");
  await expect(card.locator("a")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^הכנסות והוצאות של החברה, מאי עד אוקטובר, וצפי נובמבר/ })).toBeVisible();
  await expect(page.locator(".ui-cp-head .ui-fc-chart a")).toHaveCount(0);
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
