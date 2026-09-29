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
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.locator("#e2e-split-saved")).not.toHaveText("");
  const rows = await readSaved(page);
  const result = settled(rows);
  expect(result.sumBp).toBe(10000);
  expect(result.sum).toBe(amount);
  return rows;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/split");
  await expect(page.getByRole("heading", { name: "חלוקה בין פרויקטים" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "איך לחלק?" })).toBeVisible();
});

test("nothing is selected until one tap on every project", async ({ page }) => {
  await expect(page.getByRole("radio", { name: "שווה בין כל הפרויקטים" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
  await expect(page.getByText("בחרו איך לחלק")).toBeVisible();
  await page.getByRole("radio", { name: "שווה בין כל הפרויקטים" }).click();
  const rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([3334, 3333, 3333]);
});

test("chosen projects need two ticks and then split evenly", async ({ page }) => {
  await page.getByRole("radio", { name: "שווה בין פרויקטים שאבחר" }).click();
  await page.getByRole("button", { name: "שיפוץ הרצל 12" }).click();
  await expect(page.getByText("בחרו לפחות 2 פרויקטים")).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await expect(page.getByText("בחרו לפחות 2 פרויקטים")).toBeVisible();
  await expect(page.locator("#e2e-split-saved")).toHaveText("");
  await page.getByRole("button", { name: "פרגולה בית כהן" }).click();
  const rows = await saveAndCheck(page);
  expect(rows.map((row) => row.project_id)).toEqual(["c", "a"]);
  expect(rows.map((row) => row.share_bp)).toEqual([5000, 5000]);
});

test("income follows the project weights", async ({ page }) => {
  await page.getByRole("radio", { name: "לפי הכנסות" }).click();
  const rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([2000, 2000, 6000]);
});

test("manual percents save, including one decimal that round-trips", async ({ page }) => {
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
  const first = page.getByRole("textbox", { name: "אחוז, שיפוץ הרצל 12" });
  const second = page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" });
  const third = page.getByRole("textbox", { name: "אחוז, פרגולה בית כהן" });
  await first.fill("50");
  await second.fill("30");
  await third.fill("20");
  let rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([2000, 3000, 5000]);

  await first.fill("33.3");
  await second.fill("33.3");
  await third.fill("33.4");
  rows = await saveAndCheck(page);
  expect(rows.map((row) => row.share_bp)).toEqual([3340, 3330, 3330]);
});

test("a manual 100 does not clip and is not a contact field", async ({ page }) => {
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
  const input = page.getByRole("textbox", { name: "אחוז, שיפוץ הרצל 12" });
  await expect(input).toHaveAttribute("inputmode", "decimal");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await expect(input).toHaveAttribute("name", "split-pct-a");
  await page.getByText("שיפוץ הרצל 12", { exact: true }).click();
  await expect(input).toBeFocused();
  await input.fill("100");
  await expect(input).toHaveValue("100");
  const clipped = await input.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(clipped).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 700 });
  const narrow = await input.evaluate((node) => ({
    clip: node.scrollWidth - node.clientWidth,
    width: node.parentElement?.getBoundingClientRect().width ?? 0,
  }));
  expect(narrow.clip).toBeLessThanOrEqual(1);
  expect(narrow.width).toBeGreaterThanOrEqual(96);
  await expect(page.getByText("הסך 100%")).toBeVisible();
});

test("a failed save after browser back keeps the typed percents", async ({ page }) => {
  await page.evaluate(() => {
    const state: unknown = window.history.state;
    window.history.pushState(state, "", "/e2e/split?save=fail");
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
  await expect(page).toHaveURL(/\/e2e\/split\?save=fail$/);
  await page.getByRole("button", { name: "חלוקה ידנית" }).click();
  const first = page.getByRole("textbox", { name: "אחוז, שיפוץ הרצל 12" });
  const second = page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" });
  const third = page.getByRole("textbox", { name: "אחוז, פרגולה בית כהן" });
  await first.fill("50");
  await second.fill("30");
  await third.fill("20");
  await page.goBack();
  await expect(page.getByText("החלוקה לא נשמרה")).toBeVisible();
  await expect(page).toHaveURL(/\/e2e\/split\?save=fail$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "איך לחלק?" })).toBeVisible();
  await expect(first).toHaveValue("50");
  await expect(second).toHaveValue("30");
  await expect(third).toHaveValue("20");
});

test("a second close discards an incomplete split", async ({ page }) => {
  await page.getByRole("radio", { name: "שווה בין פרויקטים שאבחר" }).click();
  await page.getByRole("button", { name: "שיפוץ הרצל 12" }).click();
  await expect(page.getByRole("button", { name: "ביטול השינוי" })).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).not.toHaveURL(/\/e2e\/split/);
});

test("one project hides the split link that only loops back", async ({ page }) => {
  await page.getByRole("radio", { name: "לפרויקט אחד" }).click();
  await expect(page.getByRole("heading", { name: "בחירת פרויקט" })).toBeVisible();
  await expect(page.getByRole("button", { name: "פיצול בין פרויקטים" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "פרויקט חדש" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
});
