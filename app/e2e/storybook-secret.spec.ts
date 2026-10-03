import { expect, test, type Locator, type Page } from "@playwright/test";

const STORY = "/iframe.html?id=screens-routes--settings-assistant-secret&viewMode=story";

async function openSecret(page: Page): Promise<{ secret: Locator; dialog: Locator; text: string }> {
  await page.goto(STORY, { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog", { name: "הקוד מוכן" });
  const secret = page.locator("[aria-labelledby='assistant-secret-label']");
  await expect(dialog).toBeVisible();
  await expect(secret).toBeVisible();
  const fine = await page.evaluate(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  expect(fine).toBe(true);
  const text = (await secret.innerText()).replace(/\s+/g, "");
  expect(text).toBe("shown-once-example");
  return { secret, dialog, text };
}

test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

test("select-all on the shown-once secret yields the code", async ({ page }) => {
  const { secret, dialog, text } = await openSecret(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
  });
  await page.getByRole("button", { name: "העתקת הקוד" }).click();
  await expect(page.getByRole("status")).toHaveText("העתיקו ידנית");
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toBe(text);
  expect(selected).toBe("shown-once-example");
  await expect(secret).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("a fast diagonal mouse drag on the secret does not dismiss the sheet", async ({ page }) => {
  const { secret, dialog, text } = await openSecret(page);
  // Vaul ignores a dismiss drag for 500ms after the sheet opens.
  await page.waitForTimeout(600);
  const box = await secret.boundingBox();
  if (box == null) throw new Error("secret has no box");
  const startX = box.x + 16;
  const startY = box.y + Math.min(12, box.height / 3);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 180, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await expect(dialog).toBeVisible();
  await expect(secret).toHaveText(text);
});
