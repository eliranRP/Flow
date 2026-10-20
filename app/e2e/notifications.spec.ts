import { expect, test } from "@playwright/test";
import { toast } from "./controls-helpers";

// FLOW-516: Settings → התראות on the dev route's sample (no push support needed): this device's own
// row, the test push next to it, the shared switches and the connected devices.
test.use({ viewport: { width: 390, height: 844 } });

test("this device turns off and on by itself, the test push answers, and the devices are listed", async ({ page }) => {
  await page.goto("/e2e/notifications");
  const here = page.getByRole("switch", { name: "המכשיר הזה מקבל התראות" });
  await expect(here).toBeChecked();
  await page.getByRole("button", { name: "שליחת התראת בדיקה" }).click();
  await toast(page, "נשלחה התראת בדיקה");

  await expect(page.getByRole("heading", { name: "מה לקבל · לכל המכשירים" })).toBeVisible();
  const devices = page.getByRole("heading", { name: "מכשירים מחוברים" });
  await expect(devices).toBeVisible();
  await expect(page.getByText("iPhone", { exact: true })).toBeVisible();
  await expect(page.getByText("Chrome במחשב", { exact: true })).toBeVisible();
  await expect(page.getByText("המכשיר הזה", { exact: true })).toBeVisible();

  const weekly = page.getByRole("switch", { name: "סיכום שבועי" });
  await expect(weekly).toBeChecked();
  // The device row: the label wraps the visually hidden input, so tap the row.
  await here.locator("xpath=ancestor::label").click();
  await expect(here).not.toBeChecked();
  await toast(page, "ההתראות כבויות במכשיר הזה");
  // The shared switches stay as they were.
  await expect(weekly).toBeChecked();
});

test("fits a 320px phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/e2e/notifications");
  await expect(page.getByRole("switch", { name: "המכשיר הזה מקבל התראות" })).toBeAttached();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
