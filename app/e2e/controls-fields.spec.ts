import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

async function stableBox(shell: Locator) {
  const viewport = shell.page().viewportSize();
  const limit = viewport?.height ?? 800;
  let previous = "";
  let box = await shell.boundingBox();
  for (let i = 0; i < 20; i += 1) {
    await shell.page().waitForTimeout(50);
    const next = await shell.boundingBox();
    const key = next ? `${next.x.toFixed(1)}:${next.y.toFixed(1)}:${next.height.toFixed(1)}` : "";
    if (next != null && key === previous && next.y >= 0 && next.y + next.height <= limit + 1) return next;
    previous = key;
    box = next;
  }
  if (!box) throw new Error("field box missing");
  return box;
}

async function focusAt(page: Page, shell: Locator, input: Locator, xRatio: number) {
  await input.scrollIntoViewIfNeeded();
  await input.evaluate((node) => {
    (node as HTMLInputElement).blur();
  });
  const box = await stableBox(shell);
  const x = box.x + Math.min(box.width - 2, Math.max(2, box.width * xRatio));
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await expect(input).toBeFocused();
}

test("amount and text fields focus on either edge and do not clip", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  // FLOW-331: פרויקט חדש lives on +, which lands here with ?new=project.
  await page.goto("/e2e/projects?preview=1&new=project");
  const dialog = page.getByRole("dialog", { name: "פרויקט חדש" });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: "שם הפרויקט" });
  await expect(name).toBeInViewport();
  await focusAt(page, name, name, 0.02);
  await focusAt(page, name, name, 0.5);
  await focusAt(page, name, name, 0.98);
  await expect(name).toHaveAttribute("autocomplete", "off");
  expect(await name.getAttribute("name")).toMatch(/^flow-text-/);

  const amount = dialog.getByRole("textbox", { name: "תקציב (אופציונלי)" });
  const amountBox = dialog.locator(".ui-money-field");
  await focusAt(page, amountBox, amount, 0.02);
  await focusAt(page, amountBox, amount, 0.5);
  await focusAt(page, amountBox, amount, 0.98);
  await amount.fill("9999999.99");
  await expect(amount).toHaveValue("9,999,999.99");
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await expect(amount).toHaveAttribute("autocomplete", "off");
  expect(await amount.getAttribute("name")).toMatch(/^flow-amount-/);
  const fit = await amount.evaluate((node) => {
    const field = node as HTMLInputElement;
    const font = Number.parseFloat(getComputedStyle(field).fontSize);
    return { fits: field.scrollWidth <= field.clientWidth, font };
  });
  expect(fit.font).toBeGreaterThanOrEqual(16);
  expect(fit.fits).toBe(true);
  const prefixInside = await amountBox.evaluate((node) => {
    const shell = node.getBoundingClientRect();
    const prefix = node.querySelector(".ui-money-prefix")?.getBoundingClientRect();
    if (!prefix) return false;
    return prefix.left >= shell.left - 1 && prefix.right <= shell.right + 1;
  });
  expect(prefixInside).toBe(true);

  await page.goto("/e2e/split-category");
  await page.getByRole("button", { name: "חלק נוסף" }).click();
  await page.getByRole("radiogroup", { name: "יחידה, חומרי בניין" }).getByRole("radio", { name: "%" }).click();
  const share = page.locator("input[id^='lsplit-pct-']").first();
  const shareBox = share.locator("xpath=ancestor::*[contains(@class,'ui-percent-control')]");
  await focusAt(page, shareBox, share, 0.02);
  await focusAt(page, shareBox, share, 0.5);
  await focusAt(page, shareBox, share, 0.98);
  await share.fill("100");
  const shareFit = await share.evaluate((node) => (node as HTMLInputElement).scrollWidth <= (node as HTMLInputElement).clientWidth);
  expect(shareFit).toBe(true);
});
