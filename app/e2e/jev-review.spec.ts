import { expect, test } from "@playwright/test";

test("a Jev suggestion prefills the review card, and off leaves it unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/jev-review?on=1");
  await expect(page.getByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "אישור" })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=0");
  await expect(page.getByText("אין הצעה, הקישו לבחירה")).toBeVisible();
  await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeDisabled();
});

test("a long suggestion keeps הצעה inside the row at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=1&long=1");
  const tags = page.locator(".ui-review-ai .ui-suggest-tag");
  await expect(tags).toHaveCount(2);
  for (const tag of await tags.all()) {
    const box = await tag.boundingBox();
    expect(box).not.toBeNull();
    if (box == null) throw new Error("הצעה has no box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
