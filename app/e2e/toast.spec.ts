import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("a skip toast stays clear of the actions and leaves on its own", async ({ page }) => {
  await page.goto("/e2e/review");
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
  const skip = page.getByRole("button", { name: "דלג" });
  const change = page.getByRole("button", { name: "שינוי" });
  await skip.click();
  const toast = page.locator(".ui-toast");
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toHaveText(/דילגנו על הפריט/);
  await expect(page.getByRole("heading", { name: "הובלות הגליל" })).toBeVisible();
  await expect(page.getByText("2 מתוך 2")).toBeVisible();

  const toastBox = await toast.boundingBox();
  const skipBox = await skip.boundingBox();
  expect(toastBox).not.toBeNull();
  expect(skipBox).not.toBeNull();
  expect(toastBox!.y + toastBox!.height).toBeLessThan(skipBox!.y);
  await expect(page.locator(".ui-toast-host")).toHaveCSS("pointer-events", "none");
  await expect(toast).toHaveCSS("pointer-events", "auto");

  await change.click();
  await expect(page.getByText("השינוי נפתח")).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 5_000 });
});
