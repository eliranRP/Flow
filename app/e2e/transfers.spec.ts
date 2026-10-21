import { expect, test } from "@playwright/test";

// FLOW-941 (decision 0205): העברות לבדיקה on the dev fixture (invented organisations, accounts and amounts).
// Home's דורש טיפול row, the two cards, an answer with its ביטול, and the empty list.
test.use({ viewport: { width: 390, height: 844 } });

test("Home's attention box counts the suggested transfers", async ({ page }) => {
  await page.goto("/e2e/cash?transfers=1");
  const box = page.getByRole("region", { name: "דורש טיפול" });
  await expect(box.getByRole("link", { name: /2 העברות לבדיקה/ })).toBeVisible();
  await expect(box.getByText("בין חשבונות Mercury")).toBeVisible();
});

test("each card shows the money out and in, and כן, העברה hides it until ביטול", async ({ page }) => {
  await page.goto("/e2e/transfers");
  await expect(page.getByRole("heading", { name: "העברות לבדיקה" })).toBeVisible();
  const cards = page.getByRole("region", { name: /העברה אפשרית/ });
  await expect(cards).toHaveCount(2);
  const first = cards.first();
  await expect(first.getByText("זו העברה בין החשבונות שלכם?")).toBeVisible();
  await expect(first.getByText("Operations ••4821")).toBeVisible();
  await expect(first.getByText("Main ••9034")).toBeVisible();
  await expect(first.getByText("+$12,500")).toBeVisible();
  await first.getByRole("button", { name: "כן, העברה" }).click();
  await expect(cards).toHaveCount(1);
  const toast = page.getByRole("status").filter({ hasText: "סומן כהעברה" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "ביטול" }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("ההצעה חזרה לרשימה")).toBeVisible();
});

test("לא, צירוף מקרים: not suggested again; the last answer leaves the empty state", async ({ page }) => {
  await page.goto("/e2e/transfers");
  const cards = page.getByRole("region", { name: /העברה אפשרית/ });
  await cards.nth(1).getByRole("button", { name: "לא, צירוף מקרים" }).click();
  await expect(page.getByRole("status").filter({ hasText: "לא נציע שוב" })).toBeVisible();
  await cards.first().getByRole("button", { name: "כן, העברה" }).click();
  await expect(page.getByText("אין העברות לבדיקה")).toBeVisible();
});

test("the cards fit a 320px phone with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/e2e/transfers");
  await expect(page.getByRole("region", { name: /העברה אפשרית/ })).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
