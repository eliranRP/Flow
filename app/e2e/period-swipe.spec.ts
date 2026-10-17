import { expect, test, type CDPSession, type Page } from "@playwright/test";

// FLOW-336 (decision 0150): a sideways swipe on the band figure steps the period, with real touch
// events from the browser (CDP), on a phone-sized touch viewport. Chromium only.
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

async function touchSwipe(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let index = 1; index <= steps; index += 1) {
    const x = from.x + ((to.x - from.x) * index) / steps;
    const y = from.y + ((to.y - from.y) * index) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function figureRow(page: Page) {
  const swipe = page.locator(".ui-pswipe").first();
  const box = await swipe.boundingBox();
  if (!box) throw new Error("no swipe figure");
  // FLOW-355: Home's pill sits inside the swipe area, so the gesture runs across the figure line.
  const figureLine = swipe.locator(".ui-hero-figure").first();
  const figure = (await figureLine.count()) > 0 ? await figureLine.boundingBox() : null;
  const y = figure ? figure.y + figure.height / 2 : box.y + box.height / 2;
  return { y, left: box.x, right: box.x + box.width };
}

test("a swipe right on the figure goes to the earlier month, and the edge, a vertical move and a swipe left at the current month do nothing", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch events");
  await page.goto("/e2e/cash?preview=1");
  // The dev route keeps no month of its own: a step shows as the route's `?month=` (the real Home steps its state).
  const start = page.url();
  const cdp = await page.context().newCDPSession(page);
  const row = await figureRow(page);

  // At the current month a swipe left does nothing: there is no later month.
  await touchSwipe(cdp, { x: 280, y: row.y }, { x: 80, y: row.y });
  await expect(page).toHaveURL(start);

  // A start inside the 24px start-edge zone belongs to swipe-back (FLOW-332): no step.
  await touchSwipe(cdp, { x: 365, y: row.y }, { x: 165, y: row.y });
  await touchSwipe(cdp, { x: 10, y: row.y }, { x: 210, y: row.y });
  await expect(page).toHaveURL(start);

  // Mostly vertical: the page scrolls, the month stays.
  await touchSwipe(cdp, { x: 120, y: row.y }, { x: 170, y: row.y - 200 });
  await expect(page).toHaveURL(start);
  await page.evaluate(() => { window.scrollTo(0, 0); });

  // Finger moves right: the earlier month.
  await touchSwipe(cdp, { x: 80, y: row.y }, { x: 280, y: row.y + 6 });
  await expect(page).toHaveURL(/\/e2e\/cash\?month=\d{4}-\d{2}$/);
});

test("Reduced motion: the figure stays put during the drag and the period swaps on release", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch events");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/cash?preview=1");
  const cdp = await page.context().newCDPSession(page);
  const row = await figureRow(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 80, y: row.y }] });
  for (const x of [120, 180, 240, 280]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: row.y }] });
  }
  await expect(page.locator(".ui-pswipe").first()).toHaveCSS("transform", "none");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page).toHaveURL(/\/e2e\/cash\?month=\d{4}-\d{2}$/);
});
