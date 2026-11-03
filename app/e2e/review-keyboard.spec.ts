import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * FLOW-309: the review change sheet with a soft keyboard, in a real browser. Chromium has no
 * on-screen keyboard, so the test shrinks the viewport while a field has focus, as Android
 * Chrome does when it ignores `interactive-widget` (FLOW-310): innerHeight and the visual
 * viewport both lose the keyboard's height. `useKeyboardInset` (ui/keyboard-inset.ts) remembers
 * the height from before the focus, so it reads the loss as a keyboard. Invented data
 * (src/reviewer-sample.ts).
 */
const KEYBOARD = 336;

const viewports = [
  { width: 320, height: 693 },
  { width: 390, height: 844 },
] as const;

async function box(locator: Locator, what: string) {
  const found = await locator.boundingBox();
  expect(found, what).not.toBeNull();
  if (found == null) throw new Error(`${what} has no box`);
  return found;
}

async function keyboard(page: Page, viewport: { width: number; height: number }, up: boolean) {
  await page.setViewportSize({ width: viewport.width, height: up ? viewport.height - KEYBOARD : viewport.height });
}

/** The sheet and its focused field sit inside what the keyboard leaves. */
async function expectAboveKeyboard(page: Page, field: Locator, viewport: { width: number; height: number }) {
  const visible = viewport.height - KEYBOARD;
  await expect(page.locator("html")).toHaveAttribute("data-kb", "open");
  await expect(field).toBeFocused();
  await expect.poll(async () => {
    const panel = await box(page.locator(".ui-sheet-panel"), "the sheet");
    return Math.round(panel.y + panel.height);
  }, { message: "the sheet ends at the keyboard" }).toBeLessThanOrEqual(visible + 1);
  const input = await box(field, "the field");
  expect(input.y, "the field starts on screen").toBeGreaterThanOrEqual(0);
  expect(input.y + input.height, "the field ends above the keyboard").toBeLessThanOrEqual(visible);
}

/** With the keyboard gone the flag clears and the sheet sits on the bottom edge. */
async function expectKeyboardGone(page: Page, viewport: { width: number; height: number }) {
  await expect(page.locator("html")).not.toHaveAttribute("data-kb", "open");
  await expect.poll(async () => {
    const panel = await box(page.locator(".ui-sheet-panel"), "the sheet");
    return Math.round(panel.y + panel.height);
  }, { message: "the sheet is back on the bottom edge" }).toBeGreaterThanOrEqual(viewport.height - 1);
}

for (const viewport of viewports) {
  const label = `${String(viewport.width)}×${String(viewport.height)}`;

  test(`the project search stays above the keyboard and the sheet drops back after it at ${label}`, async ({ page }) => {
    await keyboard(page, viewport, false);
    await page.goto("/reviewer/save?item=q-bolts");
    await page.getByRole("button", { name: /פרויקט:/ }).click();
    await expect(page.getByRole("heading", { name: "בחירת פרויקט" })).toBeVisible();
    const search = page.getByRole("searchbox");
    await search.focus();
    await keyboard(page, viewport, true);
    await expectAboveKeyboard(page, search, viewport);
    // Typing filters with the keyboard up; the list scrolls inside the short sheet.
    await search.fill("הנמל");
    await expect(page.getByRole("radio", { name: "מחסן הנמל" })).toBeVisible();
    await expectAboveKeyboard(page, search, viewport);
    await keyboard(page, viewport, false);
    await expectKeyboardGone(page, viewport);
  });

  test(`a new project's name field stays above the keyboard and שמירה is reachable at ${label}`, async ({ page }) => {
    await keyboard(page, viewport, false);
    await page.goto("/reviewer/save?item=q-bolts");
    await page.getByRole("button", { name: /פרויקט:/ }).click();
    await page.getByRole("button", { name: "פרויקט חדש" }).click();
    const name = page.getByRole("textbox", { name: "שם" });
    await name.focus();
    await keyboard(page, viewport, true);
    await expectAboveKeyboard(page, name, viewport);
    await name.fill("גג לדוגמה");
    const save = await box(page.getByRole("button", { name: "שמירה" }), "שמירה");
    expect(save.y + save.height, "שמירה ends above the keyboard").toBeLessThanOrEqual(viewport.height - KEYBOARD);
    await keyboard(page, viewport, false);
    await expectKeyboardGone(page, viewport);
  });
}

/**
 * FLOW-1024: iOS Safari keeps the layout viewport with the keyboard up and pans the visual
 * viewport down to the field. Chromium does neither, so a stand-in visual viewport plays it:
 * the keyboard takes KEYBOARD px, then the view pans by PAN px. The sheet must end where the
 * view ends, not lifted by the whole keyboard on top of the pan (it went off the top before).
 */
const PAN = 200;

test("the sheet ends at the panned visual viewport's bottom, as on iOS", async ({ page }) => {
  const viewport = viewports[1];
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    const fake = Object.assign(new EventTarget(), {
      height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0,
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
    (window as unknown as { fakeViewport: typeof fake }).fakeViewport = fake;
  });
  await page.goto("/reviewer/save?item=q-bolts");
  await page.getByRole("button", { name: /פרויקט:/ }).click();
  await page.getByRole("button", { name: "פרויקט חדש" }).click();
  const name = page.getByRole("textbox", { name: "שם" });
  await name.focus();
  const move = (height: number, offsetTop: number, kind: string) => page.evaluate(({ height: h, offsetTop: top, kind: k }) => {
    const fake = (window as unknown as { fakeViewport: EventTarget & { height: number; offsetTop: number } }).fakeViewport;
    fake.height = h;
    fake.offsetTop = top;
    fake.dispatchEvent(new Event(k));
  }, { height, offsetTop, kind });
  const panelBottom = async () => {
    const panel = await box(page.locator(".ui-sheet-panel"), "the sheet");
    return Math.round(panel.y + panel.height);
  };
  await move(viewport.height - KEYBOARD, 0, "resize");
  await expect(page.locator("html")).toHaveAttribute("data-kb", "open");
  await expect.poll(panelBottom, { message: "the sheet ends at the keyboard" }).toBe(viewport.height - KEYBOARD);
  await move(viewport.height - KEYBOARD, PAN, "scroll");
  // The view now covers layout px PAN to PAN + its height: the keyboard starts at its bottom.
  await expect.poll(panelBottom, { message: "the sheet ends at the panned view's bottom" }).toBe(viewport.height - KEYBOARD + PAN);
  await move(viewport.height, 0, "resize");
  await name.blur();
  await move(viewport.height, 0, "resize");
  await expectKeyboardGone(page, viewport);
});
