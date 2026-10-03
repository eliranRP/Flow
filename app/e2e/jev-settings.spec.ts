import { expect, test } from "@playwright/test";

test("the Jev switch turns on and off, and off hides the options", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/settings?preview=1");
  const toggle = page.getByRole("switch", { name: "תיוג חכם (Jev)" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("button", { name: "אפשרויות" })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "אפשרויות" }).click();
  await expect(page.getByRole("radio", { name: "צל" })).toBeChecked();
  await expect(page.getByLabel("סף")).toHaveValue("0.90");

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("button", { name: "אפשרויות" })).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/settings?preview=1&nocompany=1");
  await expect(page.getByRole("switch", { name: "תיוג חכם (Jev)" })).toHaveCount(0);
});
