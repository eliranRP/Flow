import { expect, test } from "@playwright/test";

test("a Jev suggestion prefills the review card, and off leaves it unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/jev-review?on=1");
  await expect(page.getByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeVisible();
  await expect(page.getByRole("button", { name: "אישור" })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=0");
  // 0091: no hint line; the empty project row reads אין הצעה · הקישו לבחירה. This harness keeps its own disabled אישור.
  await expect(page.getByText("אין הצעה, הקישו לבחירה")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "פרויקט: אין הצעה · הקישו לבחירה" })).toBeVisible();
  await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeDisabled();
});

test("a waiting card keeps the settled height for a fill, an auto fill, one row, and a complete row", async ({ page }) => {
  // FLOW-704: the ✦ line under the rows is held (text hidden) while Jev's read waits.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 2000 });
    await page.goto("/e2e/jev-review?layout=1");
    for (const id of ["filled", "auto", "note", "sumit"]) {
      const waiting = page.locator(`[data-layout="${id}"] [data-phase="waiting"] .ui-review`);
      const settled = page.locator(`[data-layout="${id}"] [data-phase="settled"] .ui-review`);
      await expect(waiting).toBeVisible();
      // Rubik is still loading on the first paint: in the fallback face the supplier wraps to two
      // lines, so a card read before it swaps in came out 316 against 311.875 at 320.
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const waitingBox = await waiting.boundingBox();
      const settledBox = await settled.boundingBox();
      expect(waitingBox?.height, `${id} at ${String(width)}`).toBe(settledBox?.height);
    }
  }
  await expect(page.locator("[data-layout=sumit] .ui-review-reason-slot")).toHaveCount(0);
  await expect(page.locator("[data-layout=filled] [data-phase=waiting] .ui-review-reason-slot")).toBeHidden();
  await expect(page.locator(".ui-review-note")).toHaveCount(0);
  await expect(page.locator("[data-phase=waiting]").getByText("אין הצעה, הקישו לבחירה")).toHaveCount(0);
  await expect(page.locator("[data-phase=waiting]").getByText("חסר קטגוריה, הקישו לבחירה")).toHaveCount(0);
  // 0091: only a shared cost has a note, so no layout here reserves a note slot.
  await expect(page.locator("[data-phase=waiting] .ui-review-note-slot")).toHaveCount(0);
  await expect(page.locator("[data-phase=settled]").getByText("חסר קטגוריה, הקישו לבחירה")).toHaveCount(0);
  await expect(page.locator("[data-layout=note] [data-phase=settled]").getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeVisible();
});

test("a long suggestion keeps the grey הצעה and the chevron inside the row at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/e2e/jev-review?on=1&long=1");
  const hints = page.locator(".ui-review-panel .ui-review-field-hint", { hasText: "הצעה" });
  await expect(hints).toHaveCount(2);
  const inside = (box: { x: number; width: number } | null, what: string) => {
    expect(box, what).not.toBeNull();
    if (box == null) throw new Error(`${what} has no box`);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  };
  for (const hint of await hints.all()) {
    inside(await hint.boundingBox(), "הצעה");
    const row = hint.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ui-review-field ')][1]");
    inside(await row.locator("svg").last().boundingBox(), "the chevron");
    // The value wraps inside the row instead of pushing the hint or the chevron out of it.
    const value = row.locator(".ui-review-field-value");
    expect((await value.boundingBox())?.width ?? 0).toBeGreaterThan(0);
    inside(await value.boundingBox(), "the value");
  }
});
