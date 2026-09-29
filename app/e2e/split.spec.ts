import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

const amount = 1001n;

function settled(rows: Array<{ project_id: string; share_bp: number }>) {
  const sumBp = rows.reduce((sum, row) => sum + row.share_bp, 0);
  let assigned = 0n;
  const parts = rows.map((row) => {
    const agorot = (amount * BigInt(row.share_bp)) / 10000n;
    assigned += agorot;
    return agorot;
  });
  const first = parts[0];
  if (first != null && assigned !== amount) parts[0] = first + (amount - assigned);
  return { sumBp, sum: parts.reduce((sum, part) => sum + part, 0n) };
}

async function readSaved(page: Page) {
  const text = await page.locator("#e2e-split-saved").textContent();
  return JSON.parse(text ?? "[]") as Array<{ project_id: string; share_bp: number }>;
}

async function saveAndCheck(page: Page) {
  await page.getByRole("button", { name: "שמירת פיצול" }).click();
  await expect(page.locator("#e2e-split-saved")).not.toHaveText("");
  const rows = await readSaved(page);
  const result = settled(rows);
  expect(result.sumBp).toBe(10000);
  expect(result.sum).toBe(amount);
  return rows;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/split");
  await expect(page.getByRole("heading", { name: "איך לחלק?" })).toBeVisible();
});

test("equal is the default and the shares add up to the amount", async ({ page }) => {
  await expect(page.getByRole("radio", { name: "שווה בין כל הפרויקטים" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("נותר לשייך")).toHaveCount(0);
  await expect(page.getByText(/לכל אחד מ־/)).toHaveCount(0);
  const rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([3333, 3333, 3334]);
});

test("chosen projects split evenly among the ticked rows", async ({ page }) => {
  await page.getByRole("radio", { name: "שווה בין פרויקטים שאבחר" }).click();
  await expect(page.getByRole("button", { name: "שמירת פיצול" })).toBeDisabled();
  await page.getByRole("button", { name: "שיפוץ הרצל 12" }).click();
  await page.getByRole("button", { name: "פרגולה בית כהן" }).click();
  await expect(page.getByText("נותר לשייך")).toHaveCount(0);
  const rows = await saveAndCheck(page);
  expect(rows.map((row) => row.project_id)).toEqual(["a", "c"]);
  expect(rows.map((row) => row.share_bp)).toEqual([5000, 5000]);
});

test("income follows the project weights", async ({ page }) => {
  await page.getByRole("radio", { name: "לפי הכנסות" }).click();
  await expect(page.getByText("נותר לשייך")).toHaveCount(0);
  const rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([6000, 2000, 2000]);
});

test("manual percents save, including decimals that round-trip", async ({ page }) => {
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
  const first = page.getByRole("textbox", { name: "אחוז, שיפוץ הרצל 12" });
  const second = page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" });
  const third = page.getByRole("textbox", { name: "אחוז, פרגולה בית כהן" });
  await first.fill("50");
  await second.fill("30");
  await third.fill("20");
  let rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([5000, 3000, 2000]);

  await first.fill("33.33");
  await second.fill("33.33");
  await third.fill("33.34");
  rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([3333, 3333, 3334]);
});

test("a manual 100 does not clip and is not a contact field", async ({ page }) => {
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
  const input = page.getByRole("textbox", { name: "אחוז, שיפוץ הרצל 12" });
  await expect(input).toHaveAttribute("inputmode", "decimal");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await expect(input).toHaveAttribute("name", "flow-share-a");
  await page.getByText("שיפוץ הרצל 12").click();
  await expect(input).toBeFocused();
  await input.fill("100");
  await expect(input).toHaveValue("100");
  const clipped = await input.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(clipped).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 700 });
  const clippedNarrow = await input.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(clippedNarrow).toBeLessThanOrEqual(1);
  await expect(page.getByText("נותר לשייך")).toBeVisible();
});

test("light and dark both show the question", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/e2e/split");
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim());
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim());
  expect(light.toLowerCase()).toBe("#ffffff");
  expect(dark.toLowerCase()).toBe("#15111e");
  await expect(page.getByRole("heading", { name: "איך לחלק?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירת פיצול" })).toBeEnabled();
});
