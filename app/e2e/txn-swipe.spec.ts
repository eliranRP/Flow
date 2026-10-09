import { expect, test, type Page } from "@playwright/test";

/** FLOW-314: a sideways swipe on the card does what ˄ ˅ do. A real touch probe, not a click. */
test.use({ viewport: { width: 390, height: 700 }, hasTouch: true });

const next = { name: "התנועה הבאה" } as const;

/** A touch swipe across the card at mid height: a positive distance moves the finger right. */
async function swipe(page: Page, distance: number, startX = 195, dy = 0) {
  const y = 360;
  const session = await page.context().newCDPSession(page);
  const point = (x: number, yy: number) => [{ x: Math.round(x), y: Math.round(yy), id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(startX, y) });
  for (let step = 1; step <= 10; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(startX + (distance * step) / 10, y + (dy * step) / 10),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function openFromList(page: Page, name: string) {
  await page.goto("/e2e/txn-list?preview=1");
  await page.getByRole("link", { name: new RegExp(`^${name}(?!\\d)`) }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", next)).toBeVisible();
}

test("a swipe right opens the next card and a swipe left the previous one", async ({ page }) => {
  await openFromList(page, "ספק 5");
  await swipe(page, 160, 110);
  await expect(page).toHaveURL(/\/transactions\/t-step-6\?preview=1$/);
  await expect(page.getByText("ספק 6", { exact: true })).toBeVisible();
  await swipe(page, -160, 280);
  await expect(page).toHaveURL(/\/transactions\/t-step-5\?preview=1$/);
  await expect(page.getByText("ספק 5", { exact: true })).toBeVisible();
  // Each move replaced the entry, so Back still returns to the list.
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page).toHaveURL(/\/e2e\/txn-list\?preview=1$/);
});

test("the swiped-to card slides in once: a reload shows it in place, still in the list", async ({ page }) => {
  await openFromList(page, "ספק 5");
  await swipe(page, 160, 110);
  await expect(page).toHaveURL(/\/transactions\/t-step-6\?preview=1$/);
  await expect(page.locator(".ui-cswipe-card")).toHaveAttribute("data-enter", "next");
  await page.reload();
  await expect(page.getByText("ספק 6", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", next)).toBeVisible();
  await expect(page.locator(".ui-cswipe-card")).not.toHaveAttribute("data-enter");
});

test("a short move, a vertical move and the first card's previous side stay put", async ({ page }) => {
  await openFromList(page, "ספק 1");
  await swipe(page, 25);
  await swipe(page, 30, 195, 200);
  await swipe(page, -160, 280);
  await expect(page.getByText("ספק 1", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/transactions\/t-step-1\?preview=1$/);
});

test("a swipe from the start (right) edge is swipe-back's, and one from the end edge does nothing", async ({ page }) => {
  await openFromList(page, "ספק 5");
  // From the end (left) edge toward the middle: the card leaves it alone, and swipe-back starts on the other side.
  await swipe(page, 160, 10);
  await expect(page).toHaveURL(/\/transactions\/t-step-5\?preview=1$/);
  // The installed app has swipe-back (FLOW-332); the parser replaces <html>, so opt in once the page is up.
  await page.evaluate(() => {
    document.documentElement.dataset.edgeBack = "on";
  });
  // From the 24th px of the start edge, moving left: Back to the list, not the card's previous one.
  await swipe(page, -160, 390 - 24);
  await expect(page).toHaveURL(/\/e2e\/txn-list\?preview=1$/);
  // Forward is still ספק 5: the card did not also replace itself with ספק 4 on the way out.
  await page.goForward();
  await expect(page).toHaveURL(/\/transactions\/t-step-5\?preview=1$/);
});

test("the last card's next side stays put, and a card opened from a link does not swipe", async ({ page }) => {
  await openFromList(page, "ספק 24");
  await swipe(page, 160, 110);
  await expect(page).toHaveURL(/\/transactions\/t-step-24\?preview=1$/);
  await page.goto("/transactions/t-step-5?preview=1");
  await expect(page.getByText("ספק 5", { exact: true })).toBeVisible();
  await expect(page.locator(".ui-cswipe-on")).toHaveCount(0);
  await swipe(page, 160, 110);
  await swipe(page, -160, 280);
  await expect(page).toHaveURL(/\/transactions\/t-step-5\?preview=1$/);
});

test("the card follows the finger without giving the page a sideways scroll", async ({ page }) => {
  await openFromList(page, "ספק 5");
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 110, y: 360, id: 1 }] });
  for (let step = 1; step <= 8; step += 1) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 110 + step * 12, y: 361, id: 1 }] });
  }
  await expect(page.locator(".ui-cswipe-card")).toHaveCSS("transform", /matrix\(1, 0, 0, 1, 96, 0\)/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Back to where it started, so the release is no step whatever the timing.
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 110, y: 361, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  await expect(page).toHaveURL(/\/transactions\/t-step-5\?preview=1$/);
});
