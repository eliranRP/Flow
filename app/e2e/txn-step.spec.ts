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
  // FLOW-345: at the start הקודמת is hidden, not disabled, and the counter says where the card is.
  await expect(page.getByRole("button", prev)).toBeHidden();
  await expect(page.getByRole("group", { name: "מעבר בין תנועות" })).toContainText("1 מתוך 24");
  await page.goBack();
  await expect(page).toHaveURL(/\/e2e\/txn-list\?preview=1$/);
});

test("a card opened from a link has no prev or next", async ({ page }) => {
  await page.goto("/transactions/t-step-5?preview=1");
  await expect(page.getByText("ספק 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", next)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "מעבר בין תנועות" })).toHaveCount(0);
});

test("FLOW-345: the words sit at the bottom in the thumb zone, the counter stays centred at the ends, and the top bar has no arrows", async ({ page }) => {
  await page.goto("/e2e/txn-list?preview=1");
  await page.getByRole("link", { name: /^ספק 2(?!\d)/ }).click();
  const row = page.getByRole("group", { name: "מעבר בין תנועות" });
  const count = row.locator(".ui-txn-step-count");
  await expect(row).toContainText("2 מתוך 24");
  const box = await row.boundingBox();
  // Pinned at the bottom of the screen, above nothing but the safe area.
  expect(box && box.y + box.height).toBe(700);
  const prevBox = await page.getByRole("button", prev).boundingBox();
  const nextBox = await page.getByRole("button", next).boundingBox();
  // הקודמת on the right, הבאה on the left, each a 44px hit area.
  expect(prevBox && nextBox && prevBox.x > nextBox.x).toBe(true);
  expect(prevBox?.height).toBeGreaterThanOrEqual(44);
  expect(nextBox?.height).toBeGreaterThanOrEqual(44);
  expect(nextBox?.width).toBeGreaterThanOrEqual(44);
  const mid = async () => {
    const b = await count.boundingBox();
    return b ? Math.round(b.x + b.width / 2) : -1;
  };
  const middle = await mid();
  expect(Math.abs(middle - 195)).toBeLessThanOrEqual(1);
  await page.getByRole("button", prev).click();
  await expect(row).toContainText("1 מתוך 24");
  await expect(page.getByRole("button", prev)).toBeHidden();
  // Focus waits on the counter once the pressed word is hidden.
  await expect(count).toBeFocused();
  expect(await mid()).toBe(middle);
  // The top bar has Back and ⋯ only.
  const header = page.locator("header").first();
  await expect(header.getByRole("button", next)).toHaveCount(0);
  await expect(header.getByRole("button", prev)).toHaveCount(0);
});
