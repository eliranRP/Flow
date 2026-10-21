import { expect, test } from "@playwright/test";
import { previewToast, toast } from "./controls-helpers";

// FLOW-939: several AI (MCP) keys. The dev fixture lists the board's two keys; a revoke, its undo
// and a new key change the sample in the page, never the server.
test.use({ viewport: { width: 390, height: 844 } });

test("the key list opens a key, a revoke has an undo, and a new named key joins the list", async ({ page }) => {
  await page.goto("/e2e/connections/ai?assistant=connected");
  await expect(page.getByRole("heading", { name: "מפתחות פעילים · 2" })).toBeVisible();
  await page.getByRole("link", { name: /^Claude.ai · טלפון/ }).click();
  await expect(page).toHaveURL(/\/e2e\/connections\/ai\/key\/mcp-key-2/);
  await expect(page.getByText("בתוקף עד", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ביטול המפתח", exact: true }).click();
  await expect(page.getByRole("heading", { name: "מפתחות פעילים · 1" })).toBeVisible();
  const undo = page.locator(".ui-toast").filter({ hasText: "המפתח בוטל · Claude.ai · טלפון" });
  await undo.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByRole("heading", { name: "מפתחות פעילים · 2" })).toBeVisible();

  await page.getByRole("link", { name: "+ מפתח חדש" }).click();
  await expect(page).toHaveURL(/\/e2e\/connections\/ai\/new/);
  await page.getByRole("textbox", { name: "שם למפתח" }).fill("ChatGPT בטאבלט");
  await page.getByRole("radio", { name: "ChatGPT", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "כותרת" })).toBeVisible();
  await page.getByRole("button", { name: "סיום", exact: true }).click();
  await expect(page.getByRole("heading", { name: "מפתחות פעילים · 3" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^ChatGPT בטאבלט/ })).toBeVisible();
  // A long toast keeps a screen-reader copy next to the text it draws.
  await expect(page.locator(".ui-toast").getByText("המפתח נוסף · 3 מפתחות פעילים").last()).toBeVisible();

  await page.getByRole("link", { name: /^ChatGPT בטאבלט/ }).click();
  await page.getByRole("link", { name: "כל המפתחות" }).click();
  await expect(page).toHaveURL(/\/e2e\/connections\/ai\?assistant=connected$/);
});

test("a preview does not revoke a key, and the list fits at 320", async ({ page }) => {
  await page.goto("/e2e/connections/ai/key/mcp-key-1?assistant=connected&preview=1");
  await page.getByRole("button", { name: "ביטול המפתח", exact: true }).click();
  await toast(page, previewToast);
  await expect(page.getByRole("button", { name: "ביטול המפתח", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/connections/ai?assistant=connected&preview=1");
  await expect(page.getByRole("link", { name: /^Claude Code · מחשב עבודה/ })).toBeVisible();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(1);
});
