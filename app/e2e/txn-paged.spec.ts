import { expect, test, type Page } from "@playwright/test";

/**
 * FLOW-314: at the last loaded row of a paged list, הבאה loads the next page. The card stays put while
 * it loads, הבאה shows busy, and the walk goes on into the new rows, by button and by touch swipe.
 * The dev list shows 10 rows; its next page (rows 11 to 20) lands 1.5 s after it is asked for.
 */
const next = { name: "התנועה הבאה" } as const;
const stepRow = { name: "מעבר בין תנועות" } as const;

async function swipe(page: Page, width: number, distance: number) {
  const y = 360;
  const startX = Math.round(width * 0.3);
  const session = await page.context().newCDPSession(page);
  const point = (x: number) => [{ x: Math.round(x), y, id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(startX) });
  for (let step = 1; step <= 10; step += 1) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(startX + (distance * step) / 10) });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function openLast(page: Page) {
  await page.goto("/e2e/txn-paged?preview=1");
  await page.getByRole("link", { name: /^ספק 10(?!\d)/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t-step-10\?preview=1$/);
  await expect(page.getByRole("group", stepRow)).toBeVisible();
}

for (const width of [320, 393]) {
  test.describe(`at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 700 }, hasTouch: true });

    test("הבאה at the last loaded row waits, busy, on the card, then opens the first new row", async ({ page }) => {
      await openLast(page);
      const button = page.getByRole("button", next);
      await expect(button).toBeVisible();
      await button.click();
      await expect(button).toHaveAttribute("aria-busy", "true");
      await expect(page).toHaveURL(/\/transactions\/t-step-10\?preview=1$/);
      await expect(page).toHaveURL(/\/transactions\/t-step-11\?preview=1$/);
      await expect(page.getByRole("group", stepRow)).toContainText("11 מתוך 20");
    });

    test("once the next page is in, a touch swipe walks on into it", async ({ page }) => {
      await openLast(page);
      // The card reads the next page ahead once it shows.
      await expect(page.getByRole("group", stepRow)).toContainText("10 מתוך 20");
      await swipe(page, width, Math.round(width * 0.45));
      await expect(page).toHaveURL(/\/transactions\/t-step-11\?preview=1$/);
    });
  });
}
