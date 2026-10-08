import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ hasTouch: true });

async function openCode(page: Page) {
  await page.goto("/e2e/connections?preview=1&e2e=stack");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד" }).click();
  const code = page.getByRole("dialog", { name: "הקוד מוכן" });
  await expect(code).toBeVisible();
  return code;
}

async function touchSwipe(page: Page, field: Locator) {
  const box = await field.boundingBox();
  if (box == null) throw new Error("code field has no box");
  const startX = box.x + box.width * 0.3;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  const point = (x: number) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(startX) });
  const distance = 140;
  for (let step = 1; step <= 8; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(startX - (distance * step) / 8),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

async function assertEndClear(field: Locator) {
  const placed = await field.evaluate((input: HTMLInputElement) => {
    input.scrollLeft = input.scrollWidth;
    const max = Math.max(0, input.scrollWidth - input.clientWidth);
    const button = input.parentElement?.querySelector("button");
    const style = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
    const padRight = Number.parseFloat(style.paddingRight) || 0;
    const textEnd = rect.right - borderRight - padRight;
    const buttonBox = button?.getBoundingClientRect();
    return {
      scrollLeft: input.scrollLeft,
      max,
      textEnd,
      padRight,
      buttonLeft: buttonBox?.left ?? rect.right,
      buttonRight: buttonBox?.right ?? rect.right,
      innerRight: rect.right - borderRight,
      overflows: max > 1,
    };
  });
  expect(placed.overflows).toBe(true);
  expect(placed.padRight).toBeGreaterThanOrEqual(44);
  expect(placed.scrollLeft).toBeGreaterThanOrEqual(placed.max - 1);
  expect(placed.textEnd).toBeLessThanOrEqual(placed.buttonLeft + 0.5);
  expect(placed.buttonRight).toBeLessThanOrEqual(placed.innerRight + 0.5);
}

async function swipeEndAndClear(page: Page, field: Locator) {
  await expect(field).toBeVisible();
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeInViewport();
  const before = await field.evaluate((input: HTMLInputElement) => input.scrollLeft);
  await touchSwipe(page, field);
  await expect.poll(() => field.evaluate((input: HTMLInputElement) => input.scrollLeft)).toBeGreaterThan(before);
  await field.focus();
  await page.keyboard.press("End");
  await expect.poll(() => field.evaluate((input: HTMLInputElement) => {
    const max = input.scrollWidth - input.clientWidth;
    return input.selectionStart === input.value.length && input.scrollLeft >= max - 1;
  })).toBe(true);
  await assertEndClear(field);
}

for (const width of [320, 390]) {
  test(`a touch swipe scrolls the code field and End reaches the end at ${String(width)}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const code = await openCode(page);
    await swipeEndAndClear(page, code.getByRole("textbox", { name: "כתובת" }));
    await swipeEndAndClear(page, code.getByRole("textbox", { name: "קוד" }));

    await code.getByRole("button", { name: "איך מחברים ב־Claude" }).click();
    const help = page.getByRole("dialog", { name: "איך מחברים ב־Claude" });
    const command = help.getByRole("textbox", { name: "פקודת חיבור ל־Claude Code" });
    await swipeEndAndClear(page, command);

    await command.evaluate((input: HTMLInputElement) => {
      input.scrollLeft = 0;
      input.setSelectionRange(0, 0);
    });
    await command.focus();
    await page.keyboard.press("ArrowRight");
    expect(await command.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(1);
    let previous = 0;
    let moved = false;
    for (let i = 0; i < 70; i += 1) {
      await page.keyboard.press("ArrowRight");
      const scroll = await command.evaluate((input: HTMLInputElement) => input.scrollLeft);
      expect(scroll - previous).toBeLessThanOrEqual(40);
      expect(scroll - previous).toBeGreaterThanOrEqual(0);
      if (scroll > previous) moved = true;
      previous = scroll;
    }
    expect(moved).toBe(true);
    await page.keyboard.press("Home");
    expect(await command.evaluate((input: HTMLInputElement) => (
      input.scrollLeft === 0 && input.selectionStart === 0
    ))).toBe(true);

    await command.evaluate((input: HTMLInputElement) => {
      input.scrollLeft = 0;
    });
    await command.hover();
    await page.mouse.wheel(80, 0);
    await expect.poll(() => command.evaluate((input: HTMLInputElement) => input.scrollLeft)).toBeGreaterThan(0);
  });
}
