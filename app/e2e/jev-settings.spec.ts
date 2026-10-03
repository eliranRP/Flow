import { expect, test } from "@playwright/test";

test("the Jev switch turns on and off, and off hides the options", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/settings?preview=1");
  const toggle = page.getByRole("switch", { name: "תיוג חכם (Jev)" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("כבוי")).toBeVisible();
  await expect(page.getByRole("button", { name: "אפשרויות" })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText("פעיל · מצב צל")).toBeVisible();
  const options = page.getByRole("button", { name: "אפשרויות" });
  await options.click();
  await expect(options).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית.")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByLabel("סף")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("button", { name: "אפשרויות" })).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/settings?preview=1&nocompany=1");
  await expect(page.getByRole("switch", { name: "תיוג חכם (Jev)" })).toHaveCount(0);
});
