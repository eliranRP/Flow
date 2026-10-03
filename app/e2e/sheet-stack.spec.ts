import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAMPLE_ASSISTANT_SECRET } from "../src/assistant-sample";

async function dismissTop(page: Page, how: "escape" | "close" | "back", top: Locator) {
  if (how === "escape") await page.keyboard.press("Escape");
  else if (how === "close") await top.getByRole("button", { name: "סגירה" }).click();
  else await page.goBack();
}

test("closing a disconnect confirm keeps the details sheet", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&connected=1");
  await page.getByRole("button", { name: "SUMIT" }).click();
  const sumit = page.getByRole("dialog", { name: "SUMIT", exact: true });
  await expect(sumit).toBeVisible();
  for (const how of ["escape", "close", "back"] as const) {
    await sumit.getByRole("button", { name: "ניתוק" }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את SUMIT?" });
    await expect(confirm).toBeVisible();
    await dismissTop(page, how, confirm);
    await expect(confirm).toBeHidden();
    await expect(sumit).toBeVisible();
  }

  await page.goto("/e2e/settings?preview=1&assistant=connected");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  const details = page.getByRole("dialog", { name: "עוזר AI", exact: true });
  await expect(details).toBeVisible();
  for (const how of ["escape", "close", "back"] as const) {
    await details.getByRole("button", { name: "ניתוק" }).click();
    const confirm = page.getByRole("dialog", { name: "לנתק את העוזר?" });
    await expect(confirm).toBeVisible();
    await dismissTop(page, how, confirm);
    await expect(confirm).toBeHidden();
    await expect(details).toBeVisible();
  }
});

test("closing the Claude help sheet keeps the shown-once code and focuses the link", async ({ page }) => {
  await page.goto("/e2e/settings?preview=1&e2e=stack");
  await page.getByRole("button", { name: "עוזר AI", exact: true }).click();
  await page.getByRole("button", { name: "יצירת קוד" }).click();
  const code = page.getByRole("dialog", { name: "הקוד מוכן" });
  await expect(code).toBeVisible();
  await expect(code.getByText(SAMPLE_ASSISTANT_SECRET)).toBeVisible();
  const link = code.getByRole("button", { name: "איך מחברים ב־Claude" });

  for (const how of ["close", "escape", "back"] as const) {
    await link.click();
    const help = page.getByRole("dialog", { name: "איך מחברים ב־Claude" });
    const coveredCode = page.getByRole("dialog", { name: "הקוד מוכן", includeHidden: true });
    await expect(help).toBeVisible();
    await expect(coveredCode).toHaveAttribute("inert", "");
    const lowerClose = coveredCode.getByRole("button", { name: "סגירה", includeHidden: true });
    const covered = await lowerClose.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit !== node && !node.contains(hit);
    });
    expect(covered).toBe(true);
    await lowerClose.dispatchEvent("click");
    await expect(help).toBeVisible();
    await expect(coveredCode).toContainText(SAMPLE_ASSISTANT_SECRET);
    await dismissTop(page, how, help);
    await expect(help).toBeHidden();
    await expect(code).toBeVisible();
    await expect(code.getByText(SAMPLE_ASSISTANT_SECRET)).toBeVisible();
    await expect(link).toBeFocused();
  }
});
