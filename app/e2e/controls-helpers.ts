import { expect, type Locator, type Page } from "@playwright/test";

export const previewToast = "במצב תצוגה זה לא נשמר.";

export async function toast(page: Page, message: string) {
  await expect(page.locator(".ui-toast").getByText(message)).toBeVisible();
}

export async function cursorOf(locator: Locator) {
  return locator.evaluate((node) => getComputedStyle(node).cursor);
}

export function overlaps(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  return left.y < right.y + right.height && left.y + left.height > right.y
    && left.x < right.x + right.width && left.x + left.width > right.x;
}
