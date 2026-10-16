import { expect, test } from "@playwright/test";

/**
 * FLOW-366: the month lines page (נכנס / יצא). The dev sample's out lines group under their day
 * titles, and a row opens its transaction.
 */
test("the month's lines group by day and a row opens its transaction", async ({ page }) => {
  await page.goto("/e2e/cash-lines?preview=1");
  await expect(page.getByText("בנק משכנתאות לדוגמה").first()).toBeVisible();
  // Each day is a labelled group, its title the day and month (dd/mm).
  await expect(page.getByRole("region", { name: /\d{2}\/\d{2}$/ }).first()).toBeVisible();
  await page.getByText("בנק משכנתאות לדוגמה").first().click();
  await expect(page).toHaveURL(/\/transactions\//);
});
