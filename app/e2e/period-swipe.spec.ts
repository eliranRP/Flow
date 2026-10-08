import { expect, test, type CDPSession, type Page } from "@playwright/test";

// FLOW-336 (decision 0147): a sideways swipe on the band figure steps the period, with real touch
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
  const box = await page.locator(".ui-pswipe").first().boundingBox();
  if (!box) throw new Error("no swipe figure");
  return { y: box.y + box.height / 2, left: box.x, right: box.x + box.width };
}

test("Home: a swipe right on the figure goes to the earlier window, left comes back, and the edge and a vertical move do nothing", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch events");
  await page.goto("/e2e/home?preview=1");
  const later = page.getByRole("button", { name: "3 חודשים הבאים" });
  const label = page.getByRole("button", { name: /בחירת תקופה/ });
  await expect(later).toHaveAttribute("aria-disabled", "true");
  const current = await label.textContent();
  const cdp = await page.context().newCDPSession(page);
  const row = await figureRow(page);

  // Finger moves right, toward the start-side ("earlier") arrow.
  await touchSwipe(cdp, { x: 80, y: row.y }, { x: 280, y: row.y + 6 });
  await expect(later).not.toHaveAttribute("aria-disabled", "true");
  await expect(label).not.toHaveText(current ?? "");
  await expect(label).toContainText("חזרה להיום");

  // Finger moves left: the later window, back to the current one.
  await touchSwipe(cdp, { x: 280, y: row.y }, { x: 80, y: row.y });
  await expect(later).toHaveAttribute("aria-disabled", "true");
  await expect(label).toHaveText(current ?? "");

  // At the current window a further swipe left does nothing.
  await touchSwipe(cdp, { x: 280, y: row.y }, { x: 80, y: row.y });
  await expect(label).toHaveText(current ?? "");

  // A start inside the 24px start-edge zone belongs to swipe-back (FLOW-332): no step.
  await touchSwipe(cdp, { x: 365, y: row.y }, { x: 165, y: row.y });
  await touchSwipe(cdp, { x: 10, y: row.y }, { x: 210, y: row.y });
  await expect(label).toHaveText(current ?? "");

  // Mostly vertical: the page scrolls, the period stays.
  await touchSwipe(cdp, { x: 120, y: row.y }, { x: 170, y: row.y - 200 });
  await expect(label).toHaveText(current ?? "");
});

test("Project band: a swipe right on the profit steps the project's own period", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch events");
  await page.goto("/e2e/project-detail?preview=1");
  await expect(page.getByText(/^רווח ב־3 חודשים/)).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const row = await figureRow(page);
  await touchSwipe(cdp, { x: 80, y: row.y }, { x: 280, y: row.y });
  await expect(page.getByText(/^רווח ב־3 חודשים/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "3 חודשים הבאים" })).not.toHaveAttribute("aria-disabled", "true");
});

test("Reduced motion: the figure stays put during the drag and the period swaps on release", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP touch events");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/home?preview=1");
  const later = page.getByRole("button", { name: "3 חודשים הבאים" });
  const cdp = await page.context().newCDPSession(page);
  const row = await figureRow(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 80, y: row.y }] });
  for (const x of [120, 180, 240, 280]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: row.y }] });
  }
  await expect(page.locator(".ui-pswipe").first()).toHaveCSS("transform", "none");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(later).not.toHaveAttribute("aria-disabled", "true");
});
