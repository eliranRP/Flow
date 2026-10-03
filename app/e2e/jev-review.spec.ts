import { expect, test } from "@playwright/test";

test("a Jev suggestion prefills the review card, and off leaves it unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/jev-review?on=1");
  await expect(page.getByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "אישור" })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=0");
  await expect(page.getByText("אין הצעה, הקישו לבחירה")).toBeVisible();
  await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeDisabled();
});
