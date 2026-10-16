import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * FLOW-309. `fit=1` is the short-phone worst case: a supplier that wraps at 320, Jev's reason line,
 * and the plural filed-today banner. `rows=N` seeds N cards. Invented data (src/dev/review-e2e-fixture.ts).
 */
const fit = "/review?preview=1&e2e=list&fit=1";

async function box(locator: Locator, what: string) {
  const found = await locator.boundingBox();
  expect(found, what).not.toBeNull();
  if (found == null) throw new Error(`${what} has no box`);
  return found;
}

async function focused(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent.trim() ?? "");
}

test("the plural auto-approved count keeps to one line at 320, inside the header", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 693 });
  await page.goto(fit);
  const auto = page.locator(".ui-review-queue .ui-review-auto");
  await expect(auto).toHaveText("12 אושרו אוטומטית היום");
  // One line of text: the label is no taller than one line box (the digits sit on the same baseline).
  const label = await auto.locator(".ui-text-link-label").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    line: Number.parseFloat(getComputedStyle(node).lineHeight),
  }));
  expect(label.height).toBeLessThan(label.line * 1.5);
  const header = await box(page.locator(".ui-review-queue .ui-page"), "the header");
  const link = await box(auto, "the count link");
  expect(link.x).toBeGreaterThanOrEqual(header.x);
  expect(link.x + link.width).toBeLessThanOrEqual(header.x + header.width);
});

test("at 320x693 the worst-case card ends above the bar, and אישור, שינוי and דלג clear the tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 693 });
  await page.goto(fit);
  await expect(page.locator(".ui-review-reason")).toBeVisible();
  const supplier = page.getByRole("heading", { name: "חומרי בניין ואינסטלציה לדוגמה בע״מ" });
  const nameLine = await supplier.evaluate((node) => Number.parseFloat(getComputedStyle(node).lineHeight));
  expect((await box(supplier, "the supplier")).height, "the supplier wraps").toBeGreaterThan(nameLine * 1.5);
  const tabs = await box(page.locator(".ui-tabbar"), "the tab bar");
  const bar = await box(page.locator(".ui-review-queue .ui-action-bar"), "the action bar");
  const card = await box(page.locator(".ui-review"), "the card");
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
  for (const name of ["אישור", "שינוי", "דלג"]) {
    const control = await box(page.locator(".ui-action-bar").getByRole(name === "שינוי" ? "link" : "button", { name }), name);
    expect(control.y + control.height, name).toBeLessThanOrEqual(tabs.y);
  }
});

test("the counter reserves no blank digit under 10, and stays put from 9 to 10 of 12", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 693 });
  await page.goto("/review?preview=1&e2e=list");
  await expect(page.locator(".ui-review-counter")).toContainText("1 מתוך 7");
  await expect(page.locator(".ui-review-counter [data-reserve]")).toHaveCount(0);
  await page.goto("/review?preview=1&e2e=list&rows=12");
  const counter = page.locator(".ui-review-counter");
  const meter = page.locator(".ui-review-segments");
  await expect(counter).toContainText("1 מתוך 12");
  const first = { counter: await box(counter, "the counter"), meter: await box(meter, "the bar") };
  for (let step = 2; step <= 10; step += 1) {
    await page.locator(".ui-action-bar").getByRole("button", { name: "דלג" }).click();
    await expect(counter).toContainText(`${String(step)} מתוך 12`);
    const now = { counter: await box(counter, "the counter"), meter: await box(meter, "the bar") };
    expect(now.counter.x, `counter at ${String(step)}`).toBeCloseTo(first.counter.x, 0);
    expect(now.counter.width, `counter at ${String(step)}`).toBeCloseTo(first.counter.width, 0);
    expect(now.meter.x, `bar at ${String(step)}`).toBeCloseTo(first.meter.x, 0);
    expect(now.meter.width, `bar at ${String(step)}`).toBeCloseTo(first.meter.width, 0);
  }
});

test("a keyboard אישור moves focus to the next card's אישור, then to חזרה לבית, and ביטול brings it back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/review?preview=1&e2e=list&rows=2");
  const approve = page.locator(".ui-action-bar").getByRole("button", { name: "אישור" });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Lark Plumbing Co" })).toBeVisible();
  await expect(approve).toBeFocused();
  await page.keyboard.press("Enter");
  const home = page.getByRole("link", { name: "חזרה לבית" });
  await expect(home).toBeFocused();
  await page.locator(".ui-toast button", { hasText: "ביטול" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Lark Plumbing Co" })).toBeVisible();
  await expect(approve).toBeFocused();
  expect(await focused(page)).toBe("אישור");
});
