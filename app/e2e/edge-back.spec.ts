import { expect, test, type Page } from "@playwright/test";

/** FLOW-332: a swipe from the start (right) edge goes back. The installed-app check is opted into. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** The parser replaces <html> after an init script, so the opt-in goes on once the page is up. */
async function optIn(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.edgeBack = "on";
  });
}

/** A touch swipe toward the end side, starting `fromEdge` px in from the right edge. */
async function edgeSwipe(page: Page, distance: number, fromEdge = 6, dy = 0) {
  await optIn(page);
  const width = 390;
  const y = 420;
  const startX = width - fromEdge;
  const session = await page.context().newCDPSession(page);
  const point = (x: number, yy: number) => [{ x: Math.round(x), y: Math.round(yy), id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(startX, y) });
  for (let step = 1; step <= 10; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(startX - (distance * step) / 10, y + (dy * step) / 10),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function openExpense(page: Page) {
  await page.goto("/e2e/project");
  await page.getByRole("link", { name: "הוצאה לבדיקה" }).click();
  await expect(page.getByRole("heading", { name: "הוצאה לבדיקה" })).toBeVisible();
}

test("an edge swipe returns to the screen that opened this one", async ({ page }) => {
  await openExpense(page);
  await edgeSwipe(page, 180);
  await expect(page).toHaveURL(/\/e2e\/project$/);
  await expect(page.getByRole("heading", { name: "פרויקט לבדיקה" })).toBeVisible();
});

test("a fresh visit falls back to the parent, as Back does", async ({ page }) => {
  await page.goto("/settings/categories?preview=1");
  await expect(page.getByRole("heading", { name: "קטגוריות" })).toBeVisible();
  await edgeSwipe(page, 180);
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
});

test("a swipe that starts away from the edge, or turns vertical, stays", async ({ page }) => {
  await openExpense(page);
  await edgeSwipe(page, 180, 60);
  await edgeSwipe(page, 40, 6, 200);
  await expect(page.getByRole("heading", { name: "הוצאה לבדיקה" })).toBeVisible();
});

test("a tab root has no Back, so the swipe does nothing", async ({ page }) => {
  await page.goto("/settings?preview=1");
  await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
  await edgeSwipe(page, 180);
  await expect(page).toHaveURL(/\/settings\?preview=1$/);
});

test("an open sheet keeps the touch", async ({ page }) => {
  await page.goto("/settings/connections?preview=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sheet = page.getByRole("dialog", { name: "חיבור SUMIT" });
  await expect(sheet).toBeVisible();
  await edgeSwipe(page, 180);
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/connections\?preview=1$/);
});
