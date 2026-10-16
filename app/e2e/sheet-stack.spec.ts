import { expect, test, type Locator, type Page } from "@playwright/test";

async function dismissTop(page: Page, how: "escape" | "close", top: Locator) {
  if (how === "escape") await page.keyboard.press("Escape");
  else await top.getByRole("button", { name: "סגירה" }).click();
}

test("closing a disconnect confirm keeps the AI page", async ({ page }) => {
  await page.goto("/e2e/connections/ai?assistant=connected&preview=1");
  const status = page.locator(".ui-ai-status");
  await expect(status).toContainText("מחובר");
  // A confirm on a page is not history-managed (ConfirmSheet has no history entry), so Back leaves the page.
  for (const how of ["escape", "close"] as const) {
    await page.getByRole("button", { name: "ניתוק", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את העוזר?" });
    await expect(confirm).toBeVisible();
    await dismissTop(page, how, confirm);
    await expect(confirm).toBeHidden();
    await expect(status).toContainText("מחובר");
  }
});
