import { expect, test } from "@playwright/test";
import { previewToast, toast } from "./controls-helpers";

test.use({ viewport: { width: 390, height: 844 } });
// Each test opens its own page in preview mode, so the tests can run side by side and CI can
// split this file across e2e shards.
test.describe.configure({ mode: "parallel" });

test("צפייה opens today's list, a row opens the transaction, and back returns", async ({ page }) => {
  await page.goto("/e2e/review-banner");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await page.getByRole("link", { name: /אושרו אוטומטית היום/ }).click();
  await expect(page).toHaveURL(/\/review\/filed\?preview=1&sample=1$/);
  await expect(page.getByRole("heading", { name: "שויכו היום" })).toBeVisible();
  await page.getByRole("link", { name: /מנופים לדוגמה/ }).click();
  await expect(page).toHaveURL(/\/transactions\/t-filed\?preview=1$/);
  await expect(page.getByRole("button", { name: /^פרויקט / })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("heading", { name: "שויכו היום" })).toBeVisible();
  await page.getByRole("button", { name: "חזרה" }).click();
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await expect(page.getByRole("link", { name: /אושרו אוטומטית היום/ })).toBeVisible();
});

test("review approve gives a toast, change opens, and skip moves the card with no toast", async ({ page }) => {
  await page.goto("/e2e/review-banner");
  await page.getByRole("button", { name: "אישור" }).click();
  await toast(page, previewToast);
  await page.getByRole("link", { name: "שינוי" }).click();
  await expect(page).toHaveURL(/\/review\/change/);
  await page.goto("/e2e/review-banner");
  await page.getByRole("button", { name: "דלג" }).click();
  // Skip has no toast; wait for the card's exit to settle before the empty check, so it cannot pass early.
  await expect(page.locator(".ui-review-motion[data-motion='out']")).toHaveCount(0);
  await expect(page.locator(".ui-toast")).toHaveCount(0);
});

test("undo on the approve toast brings the card back", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&rows=2");
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByText("2 מתוך 2")).toBeVisible();
  await page.locator(".ui-toast button", { hasText: "ביטול" }).click();
  // The visit meter only grows (decision 0080): the undone card counts again, so the index holds at 2.
  await expect(page.getByText("2 מתוך 3")).toBeVisible();
});

test("a near-miss on ביטול undoes the card instead of dismissing the toast", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/review?preview=1&e2e=list&rows=2");
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByText("2 מתוך 2")).toBeVisible();
  const action = page.locator(".ui-toast button", { hasText: "ביטול" });
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.height).toBeLessThan(44);
  const reach = (44 - box.height) / 2;
  expect(reach).toBeGreaterThan(4);
  const point = {
    x: box.x + box.width / 2,
    y: box.y - Math.min(8, reach - 1),
  };
  const hit = await page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    const button = node instanceof Element ? node.closest("button") : null;
    return button?.textContent ?? "";
  }, point);
  expect(hit).toContain("ביטול");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("2 מתוך 3")).toBeVisible();
});

test("approving the last card shows הכל מאושר, and חזרה לבית goes home", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&rows=1");
  await expect(page.getByText("1 מתוך 1")).toBeVisible();
  await page.getByRole("button", { name: "אישור" }).click();
  await expect(page.getByText("הכל מאושר")).toBeVisible();
  await page.getByRole("link", { name: "חזרה לבית" }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
});

test("an empty review queue sends you home", async ({ page }) => {
  await page.goto("/review?preview=1");
  await page.getByRole("link", { name: "חזרה לבית" }).click();
  await expect(page).toHaveURL(/\/\?preview=1$/);
});

test("a toast dismisses on tap", async ({ page }) => {
  await page.goto("/onboarding?preview=1");
  await page.getByRole("textbox", { name: "שם העסק" }).fill("בדיקה");
  await page.getByRole("button", { name: "המשך" }).click();
  const note = page.locator(".ui-toast");
  await expect(note).toBeVisible();
  await note.click();
  await expect(note).toHaveCount(0);
});
