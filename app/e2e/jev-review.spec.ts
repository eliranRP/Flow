import { expect, test } from "@playwright/test";

test("a Jev suggestion prefills the review card, and off leaves it unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/jev-review?on=1");
  await expect(page.getByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeVisible();
  const approve = page.getByRole("button", { name: "אישור" });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.locator("#jev-corrections")).toContainText('"action":"confirm"');

  await page.getByRole("button", { name: "קטגוריה: חומרים, הצעה" }).click();
  await page.getByRole("button", { name: "קטגוריה: חומרים, שינוי" }).click();
  await page.getByRole("radio", { name: "הובלה" }).click();
  await expect(page.locator("#jev-corrections")).toContainText('"action":"fix"');
  await expect(page.getByRole("button", { name: "קטגוריה: הובלה" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=0");
  await expect(page.getByText("אין הצעה, הקישו לבחירה")).toBeVisible();
  await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeDisabled();
});
