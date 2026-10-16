import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

// The seeded queue (FLOW-365): seven USD items with invented payees, in list order r1..r7.
const queue = "/review?preview=1&e2e=list";

test("the list opens a card and Back returns to that row", async ({ page }) => {
  await page.goto(queue);
  await page.getByRole("link", { name: "הצגת הכול" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
  await page.getByRole("link", { name: /Ridge Plumbing Co/ }).click();
  await expect(page.getByRole("heading", { name: "Ridge Plumbing Co" })).toBeVisible();
  await expect(page.getByText("2 מתוך 7")).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
  const opened = page.getByRole("link", { name: /Ridge Plumbing Co/ });
  await expect(opened).toBeVisible();
  await expect(opened).toBeFocused();
});

test("Back after a refresh returns to the list", async ({ page }) => {
  await page.goto(queue);
  await page.getByRole("link", { name: "הצגת הכול" }).click();
  await page.getByRole("link", { name: /Maple Lumber/ }).click();
  await expect(page.getByRole("heading", { name: "Maple Lumber" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Maple Lumber" })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
  await expect(page.getByRole("link", { name: /Maple Lumber/ })).toBeVisible();
});

test("a pasted deep link opens that card", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&item=r4&from=all");
  await expect(page.getByRole("heading", { name: "Maple Lumber" })).toBeVisible();
  await expect(page.getByText("4 מתוך 7")).toBeVisible();
  await expect(page.getByRole("meter", { name: "התקדמות התור" })).toHaveCount(0);
});

test("a category picker opened from the card closes back to that card", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&item=r1&from=all");
  await page.getByRole("button", { name: "קטגוריה: חומרים" }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("heading", { name: "Cedar Hardware Co" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toHaveCount(0);
  await page.getByRole("button", { name: "קטגוריה: חומרים" }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Cedar Hardware Co" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toHaveCount(0);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
});

test("three approvals from a list card stay in list order", async ({ page }) => {
  await page.goto(queue);
  await page.getByRole("link", { name: "הצגת הכול" }).click();
  await page.getByRole("link", { name: /Coastal Water Co\./ }).click();
  await expect(page.getByRole("heading", { name: "Coastal Water Co." })).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByRole("heading", { name: "העברה לחיסכון לדוגמה" })).toBeVisible();
  await expect(page).toHaveURL(/item=r6/);
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByRole("heading", { name: "Quill Insurance Co" })).toBeVisible();
  await expect(page).toHaveURL(/item=r7/);
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByRole("heading", { name: "Cedar Hardware Co" })).toBeVisible();
  await expect(page).toHaveURL(/item=r1/);
  await expect(page.getByRole("heading", { name: "Coastal Water Co." })).toHaveCount(0);
});
