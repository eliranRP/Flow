import { expect, test, type Page } from "@playwright/test";

/**
 * FLOW-325. The split-by-category editor on the dev route's sample line, with the sample
 * preview standing in for `save_line_split(..., p_preview => true)`. The save keeps what it was
 * sent in sessionStorage under e2e-line-split-saved.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function addPart(page: Page, category: string, project: string, reversal = false) {
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  const categories = page.getByRole("dialog", { name: "בחירת קטגוריה" });
  await expect(categories).toBeVisible();
  // A refund line opens its reversal section expanded (FLOW-333 C3c).
  if (reversal) await expect(categories.getByRole("button", { name: "הוצאה שהוחזרה" })).toHaveAttribute("aria-expanded", "true");
  await categories.getByRole("radio", { name: category }).click();
  const projects = page.getByRole("dialog", { name: "בחירת פרויקט" });
  await expect(projects).toBeVisible();
  await projects.getByRole("radio", { name: project }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

function readSaved(page: Page): Promise<string | null> {
  return page.evaluate(() => sessionStorage.getItem("e2e-line-split-saved"));
}

async function saved(page: Page): Promise<unknown> {
  await expect.poll(() => readSaved(page)).not.toBeNull();
  return JSON.parse((await readSaved(page)) ?? "null");
}

test("an expense splits 30% and ₪500, the rest stays on the line, and ✕ saves", async ({ page }) => {
  await page.goto("/e2e/split-category");
  await expect(page.getByRole("heading", { name: "פיצול לפי קטגוריות" })).toBeVisible();
  await addPart(page, "חשמל", "פרויקט הרצליה");
  await page.getByRole("radio", { name: "%" }).click();
  await page.getByLabel("אחוז, חשמל").fill("30");
  await addPart(page, "ביטוח", "פרויקט רעננה");
  // A new part takes the last typed unit (FLOW-333 C3b), and the picker hands focus to its field (C3a).
  await expect(page.getByLabel("אחוז, ביטוח")).toBeFocused();
  await page.getByRole("radiogroup", { name: "יחידה, ביטוח" }).getByRole("radio", { name: "₪" }).click();
  await page.getByLabel("סכום, ביטוח").fill("500");
  const rest = page.getByRole("button", { name: /^השאר,/ });
  await expect(rest).toContainText("₪2,860");
  await expect(rest).toContainText("59.58%");
  await expect(page.locator(".ui-lsplit-foot")).toContainText("₪1,940");
  await page.getByRole("button", { name: "סגירה" }).click();
  expect(await saved(page)).toEqual([
    { category_id: "c-elec", project_id: "p-herz", percent: 30 },
    { category_id: "c-ins", project_id: "p-raan", amount_minor: 50000 },
    { rest: true },
  ]);
  await expect(page.getByText("הפיצול נשמר")).toBeVisible();
});

test("a refund's reversal part needs a project before it saves", async ({ page }) => {
  await page.goto("/e2e/split-category?line=refund");
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  const categories = page.getByRole("dialog", { name: "בחירת קטגוריה" });
  await expect(categories.getByRole("button", { name: "הוצאה שהוחזרה" })).toHaveAttribute("aria-expanded", "true");
  await categories.getByRole("radio", { name: "חומרי בניין" }).click();
  const projects = page.getByRole("dialog", { name: "בחירת פרויקט" });
  await expect(projects.getByText("חלק החזר צריך פרויקט.")).toBeVisible();
  await expect(projects.getByRole("radio", { name: /פרויקט השורה/ })).toHaveCount(0);
  // Leave the picker without a project: the part shows it is missing one.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("סכום, חומרי בניין").fill("500");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByText("בחרו פרויקט לחלק ההחזר.")).toBeVisible();
  expect(await readSaved(page)).toBeNull();
  // The part's row opens straight on the project list while it misses one.
  await page.getByRole("button", { name: /^חומרי בניין, החזר/ }).click();
  await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: "פרויקט הרצליה" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^השאר,/ })).toContainText("₪750");
  await page.getByRole("button", { name: "סגירה" }).click();
  expect(await saved(page)).toEqual([
    { category_id: "c-build", project_id: "p-herz", amount_minor: 50000 },
    { rest: true },
  ]);
});

test("a dropped connection keeps the screen and offers ניסיון חוזר", async ({ page }) => {
  await page.goto("/e2e/split-category?save=fail");
  await addPart(page, "חשמל", "פרויקט הרצליה");
  await page.getByLabel("סכום, חשמל").fill("100");
  await expect(page.getByRole("button", { name: /^השאר,/ })).toContainText("₪4,700");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByText("הפיצול לא נשמר")).toBeVisible();
  await expect(page.getByRole("button", { name: "ניסיון חוזר" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "פיצול לפי קטגוריות" })).toBeVisible();
});
