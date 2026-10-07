import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 700 } });

const next = { name: "התנועה הבאה" } as const;
const prev = { name: "התנועה הקודמת" } as const;

test("prev and next walk the list, and Back returns to its scroll spot", async ({ page }) => {
  await page.goto("/e2e/txn-list?preview=1");
  const row = page.getByRole("link", { name: /^ספק 12(?!\d)/ });
  await row.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await row.click();
  await expect(page.getByText("ספק 12", { exact: true })).toBeVisible();

  await page.getByRole("button", next).click();
  await expect(page).toHaveURL(/\/transactions\/t-step-13\?preview=1$/);
  await expect(page.getByRole("button", next)).toBeFocused();
  await page.getByRole("button", next).click();
  await expect(page.getByText("ספק 14", { exact: true })).toBeVisible();
  await page.getByRole("button", prev).click();
  await expect(page).toHaveURL(/\/transactions\/t-step-13\?preview=1$/);

  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/e2e\/txn-list\?preview=1$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});

test("the arrow keys move the right-to-left way", async ({ page }) => {
  await page.goto("/e2e/txn-list?preview=1");
  await page.getByRole("link", { name: /^ספק 2(?!\d)/ }).click();
  await expect(page.getByRole("button", next)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/transactions\/t-step-3\?preview=1$/);
  // The URL changes first; a press waits until the next card is on screen.
  await expect(page.getByText("ספק 3", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/transactions\/t-step-2\?preview=1$/);
  await expect(page.getByText("ספק 2", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/transactions\/t-step-1\?preview=1$/);
  await expect(page.getByRole("button", prev)).toHaveAttribute("aria-disabled", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/txn-list\?preview=1$/);
});

test("a card opened from a link has no prev or next", async ({ page }) => {
  await page.goto("/transactions/t-step-5?preview=1");
  await expect(page.getByText("ספק 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", next)).toHaveCount(0);
});
