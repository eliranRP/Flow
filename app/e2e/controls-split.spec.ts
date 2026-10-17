import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });
// Preview-mode tests, one page per test (see controls-review.spec.ts).
test.describe.configure({ mode: "parallel" });

test("split parts, units, the hold, and close", async ({ page }) => {
  await page.goto("/e2e/split-category");
  await expect(page.getByRole("button", { name: "שמירה", exact: true })).toBeDisabled();
  await expect(page.getByText("מה שלא פוצל נשאר בשורה.")).toBeVisible();
  await page.getByRole("button", { name: "חלק נוסף" }).click();
  await page.getByRole("button", { name: /, פרויקט, שינוי$/ }).last().click();
  await page.getByRole("dialog", { name: /^(בחירת פרויקט|פרויקט לחלק \d+)$/ }).getByRole("radio", { name: "פרויקט רעננה" }).click();
  await page.getByRole("radiogroup", { name: "יחידה, חומרי בניין" }).getByRole("radio", { name: "%" }).click();
  const field = page.getByRole("textbox", { name: "אחוז, חומרי בניין" });
  await field.fill("120");
  await expect(page.getByText("עד 100%")).toBeVisible();
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page).toHaveURL(/\/e2e\/split-category$/);
  await expect(page.getByRole("button", { name: "ביטול השינוי" })).toBeVisible();
  await field.fill("40");
  await page.getByRole("button", { name: /^הסרת החלק/ }).click();
  await expect(page.getByRole("textbox", { name: "אחוז, חומרי בניין" })).toHaveCount(0);
  await page.getByRole("button", { name: "חלק נוסף" }).click();
  await page.getByRole("button", { name: /, פרויקט, שינוי$/ }).last().click();
  await page.getByRole("dialog", { name: /^(בחירת פרויקט|פרויקט לחלק \d+)$/ }).getByRole("radio", { name: "פרויקט הרצליה" }).click();
  await page.getByRole("radiogroup", { name: "יחידה, חומרי בניין" }).getByRole("radio", { name: "%" }).click();
  await page.getByRole("textbox", { name: "אחוז, חומרי בניין" }).fill("50");
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("e2e-line-split-saved"))).not.toBeNull();
  await expect(page).toHaveURL(/\/e2e\/split-category\/done$/);
});
