import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

const queue = "/review?preview=1&e2e=list";

test("the list opens a card and Back returns to that row", async ({ page }) => {
  await page.goto(queue);
  await page.getByRole("link", { name: "הצגת הכול" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
  await page.getByRole("link", { name: /עגורני החוף/ }).click();
  await expect(page.getByRole("heading", { name: "עגורני החוף" })).toBeVisible();
  await expect(page.getByText("2 מתוך 5")).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
  const opened = page.getByRole("link", { name: /עגורני החוף/ });
  await expect(opened).toBeVisible();
  await expect(opened).toBeFocused();
});

test("Back after a refresh returns to the list", async ({ page }) => {
  await page.goto(queue);
  await page.getByRole("link", { name: "הצגת הכול" }).click();
  await page.getByRole("link", { name: /ברזל הדרום/ }).click();
  await expect(page.getByRole("heading", { name: "ברזל הדרום" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "ברזל הדרום" })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
  await expect(page.getByRole("link", { name: /ברזל הדרום/ })).toBeVisible();
});

test("a pasted deep link opens that card", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&item=r3&from=all");
  await expect(page.getByRole("heading", { name: "ברזל הדרום" })).toBeVisible();
  await expect(page.getByText("3 מתוך 5")).toBeVisible();
  await expect(page.getByRole("meter", { name: "התקדמות התור" })).toHaveCount(0);
});

test("a category picker opened from the card closes back to that card", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&item=r1&from=all");
  await page.getByRole("button", { name: "קטגוריה: חומרים" }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("heading", { name: "מחסן הנמל" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toHaveCount(0);
  await page.getByRole("button", { name: "קטגוריה: חומרים" }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "מחסן הנמל" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toHaveCount(0);
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/review\/all\?/);
});

test("three approvals from a list card stay in list order", async ({ page }) => {
  await page.goto(queue);
  await page.getByRole("link", { name: "הצגת הכול" }).click();
  await page.getByRole("link", { name: /ברזל הדרום/ }).click();
  await expect(page.getByRole("heading", { name: "ברזל הדרום" })).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByRole("heading", { name: "צבע הדרום" })).toBeVisible();
  await expect(page).toHaveURL(/item=r4/);
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByRole("heading", { name: "חשמל הצפון" })).toBeVisible();
  await expect(page).toHaveURL(/item=r5/);
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByRole("heading", { name: "מחסן הנמל" })).toBeVisible();
  await expect(page).toHaveURL(/item=r1/);
  await expect(page.getByRole("heading", { name: "עגורני החוף" })).toHaveCount(0);
});
