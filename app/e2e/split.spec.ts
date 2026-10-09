import { expect, test, type Page } from "@playwright/test";

/**
 * FLOW-346. The split between projects, built like the split by categories, on the dev route's
 * ₪10.01 sample line. The save writes its rows to #e2e-split-saved.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function addPart(page: Page, project: string) {
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  const projects = page.getByRole("dialog", { name: "בחירת פרויקט" });
  await expect(projects).toBeVisible();
  await projects.getByRole("radio", { name: project }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function readSaved(page: Page) {
  await expect(page.locator("#e2e-split-saved")).not.toHaveText("");
  const text = await page.locator("#e2e-split-saved").textContent();
  return JSON.parse(text ?? "[]") as Array<{ project_id: string; amount_minor: number }>;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/split");
  await expect(page.getByRole("heading", { name: "פיצול בין פרויקטים" })).toBeVisible();
});

test("opens on the rest, with no ways to choose and no save button", async ({ page }) => {
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^השאר, שיפוץ הרצל 12/ })).toContainText("₪10.01");
  await expect(page.getByText("נשאר לשורה")).toBeVisible();
});

test("an exact amount saves to the cent, and the rest keeps the line's project", async ({ page }) => {
  await addPart(page, "פרגולה בית כהן");
  const field = page.getByLabel("סכום, פרגולה בית כהן");
  await expect(field).toBeFocused();
  await field.fill("3.37");
  await expect(page.getByRole("button", { name: /^השאר,/ })).toContainText("₪6.64");
  await page.getByRole("button", { name: "סגירה" }).click();
  expect(await readSaved(page)).toEqual([
    { project_id: "c", amount_minor: 337 },
    { project_id: "a", amount_minor: 664 },
  ]);
});

test("a percent part rounds to whole agorot and the parts add up to the line", async ({ page }) => {
  await addPart(page, "שיפוץ דירה ביאליק 8 חולון");
  await page.getByRole("radiogroup", { name: "יחידה, שיפוץ דירה ביאליק 8 חולון" }).getByRole("radio", { name: "%" }).click();
  await page.getByLabel("אחוז, שיפוץ דירה ביאליק 8 חולון").fill("50");
  await page.getByRole("button", { name: "סגירה" }).click();
  const rows = await readSaved(page);
  expect(rows.map((row) => row.project_id)).toEqual(["b", "a"]);
  expect(rows.reduce((sum, row) => sum + row.amount_minor, 0)).toBe(1001);
});

test("parts past the line hold once, then a second close discards", async ({ page }) => {
  await addPart(page, "פרגולה בית כהן");
  await page.getByLabel("סכום, פרגולה בית כהן").fill("20");
  await expect(page.getByText("עוברים את השורה", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByRole("button", { name: "ביטול השינוי" })).toBeVisible();
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await expect(page.locator("#e2e-split-saved")).toHaveText("");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).not.toHaveURL(/\/e2e\/split/);
});

test("a failed save after browser back keeps the typed amount", async ({ page }) => {
  await page.goto("/e2e/project");
  await page.getByRole("link", { name: "פיצול שנכשל" }).click();
  await expect(page).toHaveURL(/\/e2e\/split\?save=fail$/);
  await addPart(page, "פרגולה בית כהן");
  await page.getByLabel("סכום, פרגולה בית כהן").fill("5");
  await page.goBack();
  await expect(page.getByText("הפיצול לא נשמר")).toBeVisible();
  await expect(page).toHaveURL(/\/e2e\/split\?save=fail$/);
  await expect(page.getByLabel("סכום, פרגולה בית כהן")).toHaveValue("5");
});

test("the project picker hides the split link that only loops back", async ({ page }) => {
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  await expect(page.getByRole("heading", { name: "בחירת פרויקט" })).toBeVisible();
  await expect(page.getByRole("button", { name: "פיצול בין פרויקטים" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "פרויקט חדש" })).toBeVisible();
});

test("light and dark both show the parts", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/e2e/split");
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim());
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim());
  expect(light.toLowerCase()).toBe("#ffffff");
  expect(dark.toLowerCase()).toBe("#15111e");
  await expect(page.getByRole("button", { name: "הוספת חלק" })).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
});
