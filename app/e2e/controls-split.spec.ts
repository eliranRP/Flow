import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("split parts, units, the hold, and close", async ({ page }) => {
  await page.goto("/e2e/split");
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
  await expect(page.getByText("נשאר לשורה")).toBeVisible();
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: "שיפוץ דירה ביאליק 8 חולון" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("radiogroup", { name: "יחידה, שיפוץ דירה ביאליק 8 חולון" }).getByRole("radio", { name: "%" }).click();
  const field = page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" });
  await field.fill("120");
  await expect(page.getByText("עד 100%")).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/e2e\/split$/);
  await expect(page.getByRole("button", { name: "ביטול השינוי" })).toBeVisible();
  await field.fill("40");
  await page.getByRole("button", { name: /^הסרת החלק/ }).click();
  await expect(page.getByRole("textbox", { name: "אחוז, שיפוץ דירה ביאליק 8 חולון" })).toHaveCount(0);
  await page.getByRole("button", { name: "הוספת חלק" }).click();
  await page.getByRole("dialog", { name: "בחירת פרויקט" }).getByRole("radio", { name: "פרגולה בית כהן" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
  await page.getByRole("textbox", { name: "אחוז, פרגולה בית כהן" }).fill("50");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.locator("#e2e-split-saved")).not.toHaveText("");
  await expect(page).toHaveURL(/\/transactions\//);
});
