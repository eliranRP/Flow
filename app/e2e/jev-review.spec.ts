import { expect, test } from "@playwright/test";

test("a Jev suggestion prefills the review card, and off leaves it unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/jev-review?on=1");
  await expect(page.getByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeVisible();
  await expect(page.getByRole("button", { name: "אישור" })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=0");
  // 0091: no hint line; the empty row reads "לא נבחר". This harness keeps its own disabled אישור.
  await expect(page.getByText("אין הצעה, הקישו לבחירה")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "פרויקט: לא נבחר" })).toBeVisible();
  await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeDisabled();
});

test("a waiting card keeps the settled height for a fill, a note, and a complete row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.goto("/e2e/jev-review?layout=1");
  for (const id of ["filled", "note", "sumit"]) {
    const waiting = page.locator(`[data-layout="${id}"] [data-phase="waiting"] .ui-review`);
    const settled = page.locator(`[data-layout="${id}"] [data-phase="settled"] .ui-review`);
    await expect(waiting).toBeVisible();
    const waitingBox = await waiting.boundingBox();
    const settledBox = await settled.boundingBox();
    expect(waitingBox?.height).toBe(settledBox?.height);
  }
  await expect(page.locator(".ui-review-note")).toHaveCount(0);
  await expect(page.locator("[data-phase=waiting]").getByText("אין הצעה, הקישו לבחירה")).toHaveCount(0);
  await expect(page.locator("[data-phase=waiting]").getByText("חסר קטגוריה, הקישו לבחירה")).toHaveCount(0);
  // 0091: only a shared cost has a note, so no layout here reserves a note slot.
  await expect(page.locator("[data-phase=waiting] .ui-review-note-slot")).toHaveCount(0);
  await expect(page.locator("[data-phase=settled]").getByText("חסר קטגוריה, הקישו לבחירה")).toHaveCount(0);
  await expect(page.locator("[data-layout=note] [data-phase=settled]").getByRole("button", { name: "קטגוריה: לא נבחר" })).toBeVisible();
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
