import { expect, test } from "@playwright/test";

test("the Jev switch turns on and off, and off hides the options", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/connections?preview=1");
  const toggle = page.getByRole("switch", { name: "תיוג חכם (Jev)" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("כבוי", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "אפשרויות" })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  // FLOW-702 (#231): on means suggestions only until auto fill is chosen under אפשרויות.
  await expect(page.getByText("פעיל · הצעות בלבד", { exact: true })).toBeVisible();
  // FLOW-704: the saved switch is said once to screen readers.
  await expect(page.locator("[data-jev-said]")).toHaveText("תיוג חכם (Jev): פעיל · הצעות בלבד");
  const options = page.getByRole("button", { name: "אפשרויות" });
  await options.click();
  await expect(options).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("radio", { name: "הצעות בלבד" })).toBeChecked();
  await expect(page.getByText("ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית.")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "סף ביטחון" })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("button", { name: "אפשרויות" })).toHaveCount(0);
  await expect(page.locator("[data-jev-said]")).toHaveText("תיוג חכם (Jev): כבוי");

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/connections?preview=1&nocompany=1");
  await expect(page.getByRole("switch", { name: "תיוג חכם (Jev)" })).toHaveCount(0);
});
