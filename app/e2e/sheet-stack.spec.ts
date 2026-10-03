import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAMPLE_ASSISTANT_SECRET } from "../src/assistant-sample";

async function dismissTop(page: Page, how: "escape" | "close" | "back", top: Locator) {
  if (how === "escape") await page.keyboard.press("Escape");
  else if (how === "close") await top.getByRole("button", { name: "סגירה" }).click();
  else await page.goBack();
}

test("closing a disconnect confirm keeps the details sheet", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&connected=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sumit = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await expect(sumit).toBeVisible();
  for (const how of ["escape", "close", "back"] as const) {
    await sumit.getByRole("button", { name: "ניתוק" }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את SUMIT?" });
    await expect(confirm).toBeVisible();
    await dismissTop(page, how, confirm);
    await expect(confirm).toBeHidden();
    await expect(sumit).toBeVisible();
  }

  await page.goto("/e2e/settings?preview=1&assistant=connected");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  const details = page.getByRole("dialog", { name: "עוזר AI", exact: true });
  await expect(details).toBeVisible();
  for (const how of ["escape", "close", "back"] as const) {
    await details.getByRole("button", { name: "ניתוק" }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את העוזר?" });
    await expect(confirm).toBeVisible();
    await dismissTop(page, how, confirm);
    await expect(confirm).toBeHidden();
    await expect(details).toBeVisible();
  }
});

test("closing the Claude help sheet keeps the shown-once code and focuses the link", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&e2e=stack");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד" }).click();
  const code = page.getByRole("dialog", { name: "הקוד מוכן" });
  await expect(code).toBeVisible();
  await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
  const link = code.getByRole("button", { name: "איך מחברים ב־Claude" });

  for (const how of ["close", "escape", "back"] as const) {
    await link.click();
    const help = page.getByRole("dialog", { name: "איך מחברים ב־Claude" });
    const coveredCode = page.getByRole("dialog", { name: "הקוד מוכן", includeHidden: true });
    await expect(help).toBeVisible();
    await expect(coveredCode).toHaveAttribute("inert", "");
    const lowerClose = coveredCode.getByRole("button", { name: "סגירה", includeHidden: true });
    const covered = await lowerClose.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit !== node && !node.contains(hit);
    });
    expect(covered).toBe(true);
    await dismissTop(page, how, help);
    await expect(help).toBeHidden();
    await expect(code).toBeVisible();
    await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
    await expect(link).toBeFocused();
  }
});

test("a tap on step 2 while help is fading keeps the code sheet open", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&e2e=stack");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד" }).click();
  const code = page.getByRole("dialog", { name: "הקוד מוכן" });
  await expect(code).toBeVisible();
  await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
  const copy = code.getByRole("button", { name: "העתקה: קוד" });
  await copy.evaluate((node: HTMLElement) => {
    node.focus({ focusVisible: true } as FocusOptions);
  });
  await expect.poll(() => copy.evaluate((node) => getComputedStyle(node).outlineOffset)).toBe("-2px");
  await code.getByRole("button", { name: "איך מחברים ב־Claude" }).click();
  const help = page.getByRole("dialog", { name: "איך מחברים ב־Claude" });
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "סגירה" }).click();
  await page.waitForTimeout(50);
  const spot = await page.evaluate(() => {
    const drawers = [...document.querySelectorAll<HTMLElement>("[data-vaul-drawer]")];
    const codePanel = drawers.find((node) => node.getAttribute("data-state") === "open");
    const helpPanel = drawers.find((node) => node.getAttribute("data-state") === "closed");
    const field = codePanel?.querySelector("input");
    if (codePanel == null || field == null) return null;
    const codeBox = codePanel.getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    const helpBox = helpPanel?.getBoundingClientRect();
    let x = fieldBox.x + Math.min(48, fieldBox.width / 2);
    let y = fieldBox.y + fieldBox.height / 2;
    if (helpBox != null && y >= helpBox.y && y <= helpBox.y + helpBox.height) {
      const above = helpBox.y - 12;
      if (above > codeBox.y + 12) {
        y = above;
        x = codeBox.x + codeBox.width / 2;
      }
    }
    y = Math.min(Math.max(y, codeBox.y + 12), codeBox.y + codeBox.height - 12);
    return { x, y };
  });
  if (spot == null) throw new Error("code sheet has no box");
  await page.mouse.click(spot.x, spot.y);
  await expect(code).toBeVisible();
  await expect(help).toBeHidden();
  await expect(code).toBeVisible();
  await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
});

test("a double tap on the help backdrop keeps the shown-once code", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&e2e=stack");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד" }).click();
  const code = page.getByRole("dialog", { name: "הקוד מוכן" });
  await expect(code).toBeVisible();
  await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
  await code.getByRole("button", { name: "איך מחברים ב־Claude" }).click();
  const help = page.getByRole("dialog", { name: "איך מחברים ב־Claude" });
  await expect(help).toBeVisible();
  const viewport = page.viewportSize();
  const x = (viewport?.width ?? 390) / 2;
  const y = 20;
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
  await expect(help).toBeHidden();
  await expect(code).toBeVisible();
  await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
  await page.mouse.click(x, y);
  await expect(code).toBeVisible();
  await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
  await page.keyboard.press("Escape");
  await expect(code).toBeHidden();
});

test("a tap under the only closing sheet does not open a sheet or follow a link", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&connected=1");
  const settings = page.url();
  const categories = page.getByRole("link", { name: "קטגוריות" });
  await categories.scrollIntoViewIfNeeded();
  const row = await categories.boundingBox();
  if (row == null) throw new Error("categories row has no box");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sumit = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await expect(sumit).toBeVisible();
  await sumit.getByRole("button", { name: "סגירה" }).click();
  await page.waitForTimeout(80);
  await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(settings);
  await expect(page.locator("[role='dialog'][data-state='open']")).toHaveCount(0);
});

test("a second ✕ 60ms later does not activate the row underneath", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&connected=1");
  const settings = page.url();
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sumit = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await expect(sumit).toBeVisible();
  const close = await sumit.getByRole("button", { name: "סגירה" }).boundingBox();
  if (close == null) throw new Error("close control has no box");
  const x = close.x + close.width / 2;
  const y = close.y + close.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(60);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(settings);
  await expect(page.locator("[role='dialog'][data-state='open']")).toHaveCount(0);
});

test("Back then Forward still closes the sheet under the restored entry", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&e2e=stack");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד" }).click();
  const code = page.getByRole("dialog", { name: "הקוד מוכן" });
  await expect(code).toBeVisible();
  const link = code.getByRole("button", { name: "איך מחברים ב־Claude" });

  for (const how of ["escape", "close"] as const) {
    await link.click();
    const help = page.getByRole("dialog", { name: "איך מחברים ב־Claude" });
    await expect(help).toBeVisible();
    await page.goBack();
    await expect(help).toBeHidden();
    await expect(code).toBeVisible();
    await page.goForward();
    await expect(help).toBeHidden();
    await expect(code).toBeVisible();
    await expect(code.getByRole("textbox", { name: "קוד" })).toHaveValue(SAMPLE_ASSISTANT_SECRET);
    if (how === "escape") await page.keyboard.press("Escape");
    else await code.getByRole("button", { name: "סגירה" }).click();
    await expect(code).toBeHidden();
    await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
    await page.getByRole("button", { name: "יצירת קוד" }).click();
    await expect(code).toBeVisible();
  }

  await page.goto("/e2e/settings?preview=1&connected=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sumit = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await expect(sumit).toBeVisible();
  for (const how of ["escape", "close"] as const) {
    await sumit.getByRole("button", { name: "ניתוק" }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את SUMIT?" });
    await expect(confirm).toBeVisible();
    await page.goBack();
    await expect(confirm).toBeHidden();
    await expect(sumit).toBeVisible();
    await page.goForward();
    await expect(confirm).toBeHidden();
    await expect(sumit).toBeVisible();
    if (how === "escape") await page.keyboard.press("Escape");
    else await sumit.getByRole("button", { name: "סגירה" }).click();
    await expect(sumit).toBeHidden();
    await page.getByRole("button", { name: "SUMIT" }).click();
    await expect(sumit).toBeVisible();
  }

  await page.goto("/e2e/settings?preview=1&assistant=connected");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  const details = page.getByRole("dialog", { name: "עוזר AI", exact: true });
  await expect(details).toBeVisible();
  for (const how of ["escape", "close"] as const) {
    await details.getByRole("button", { name: "ניתוק" }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את העוזר?" });
    await expect(confirm).toBeVisible();
    await page.goBack();
    await expect(confirm).toBeHidden();
    await expect(details).toBeVisible();
    await page.goForward();
    await expect(confirm).toBeHidden();
    await expect(details).toBeVisible();
    if (how === "escape") await page.keyboard.press("Escape");
    else await details.getByRole("button", { name: "סגירה" }).click();
    await expect(details).toBeHidden();
    await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
    await expect(details).toBeVisible();
  }
});

test("a double tap on סיום pops one history step, and open and close can repeat", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&e2e=stack");
  const row = page.getByRole("button", { name: "עוזר AI", exact: true });
  const settings = page.url();

  async function openCode() {
    await row.click();
    await page.getByRole("button", { name: "יצירת קוד" }).click();
    await expect(page.getByRole("dialog", { name: "הקוד מוכן" })).toBeVisible();
  }

  await openCode();
  await page.getByRole("button", { name: "סיום" }).evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    node.click();
    node.click();
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(settings);
  await expect(row).toBeVisible();

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await openCode();
    await page.getByRole("button", { name: "סיום" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(settings);
    await expect(row).toBeVisible();
  }
});
