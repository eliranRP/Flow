import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAMPLE_ASSISTANT_SECRET } from "../src/assistant-sample";

const STORY = "/iframe.html?id=screens-ai-connection--code-ready-other&viewMode=story";
const HEADER = `Authorization: Bearer ${SAMPLE_ASSISTANT_SECRET}`;

async function openSecret(page: Page): Promise<{ secret: Locator; done: Locator; text: string }> {
  await page.goto(STORY, { waitUntil: "domcontentloaded" });
  const done = page.getByRole("button", { name: "סיום" });
  const secret = page.getByRole("group", { name: "כותרת" }).getByRole("textbox", { name: "כותרת" });
  await expect(done).toBeVisible();
  await expect(secret).toBeVisible();
  const fine = await page.evaluate(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  expect(fine).toBe(true);
  const text = await secret.inputValue();
  expect(text).toBe(HEADER);
  return { secret, done, text };
}

test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

test("select-all on the shown-once header yields the code", async ({ page }) => {
  const { secret, done, text } = await openSecret(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
  });
  const field = page.getByRole("group", { name: "כותרת" });
  const copy = field.getByRole("button", { name: "העתקה: כותרת" });
  const copyBox = await copy.boundingBox();
  if (copyBox == null) throw new Error("copy has no box");
  expect(copyBox.width).toBeGreaterThanOrEqual(44);
  expect(copyBox.height).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(field.getByRole("status")).toHaveText("העתיקו ידנית");
  const selected = await secret.evaluate((node) => {
    if (!(node instanceof HTMLInputElement)) return "";
    return node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0);
  });
  expect(selected).toBe(text);
  expect(selected).toBe(HEADER);
  await expect(secret).toBeVisible();
  await expect(done).toBeVisible();
});

test("a fast diagonal mouse drag on the header keeps the code on screen", async ({ page }) => {
  const { secret, done, text } = await openSecret(page);
  const box = await secret.boundingBox();
  if (box == null) throw new Error("secret has no box");
  const startX = box.x + 16;
  const startY = box.y + Math.min(12, box.height / 3);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 180, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await expect(done).toBeVisible();
  await expect(secret).toHaveValue(text);
});
