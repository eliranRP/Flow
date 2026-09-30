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

for (const viewport of [
  { width: 320, height: 693 },
  { width: 390, height: 844 },
] as const) {
  for (const safe of [0, 20, 47] as const) {
    test(`toast pad moves once at ${String(viewport.width)}×${String(viewport.height)} with safe area ${String(safe)}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await page.getByRole("button", { name: /קטגוריה:/ }).click();
      await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
      await page.evaluate((inset) => {
        document.documentElement.style.setProperty("--safe-top", `${String(inset)}px`);
        const samples: Array<{ t: number; pad: number; covers: boolean; top: number | null; visible: boolean }> = [];
        const start = performance.now();
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.width > 0 && b.width > 0
          && a.top < b.bottom - 0.5
          && a.bottom > b.top + 0.5
          && a.left < b.right - 0.5
          && a.right > b.left + 0.5;
        const frame = () => {
          const surface = document.querySelector(".ui-sheet-surface");
          const pad = surface instanceof HTMLElement ? Number.parseFloat(getComputedStyle(surface).paddingTop) || 0 : 0;
          const toastNode = document.querySelector(".ui-toast");
          let top: number | null = null;
          let visible = false;
          let covers = false;
          if (toastNode instanceof HTMLElement) {
            const toastStyle = getComputedStyle(toastNode);
            const opacity = Number.parseFloat(toastStyle.opacity) || 0;
            visible = opacity > 0.02 && toastStyle.visibility !== "hidden";
            const toastRect = toastNode.getBoundingClientRect();
            top = toastRect.top;
            if (visible) {
              for (const label of ["סגירה", "חזרה"]) {
                const control = document.querySelector(`button[aria-label="${label}"]`);
                if (control instanceof HTMLElement && overlaps(toastRect, control.getBoundingClientRect())) covers = true;
              }
            }
          }
          samples.push({ t: performance.now() - start, pad, covers, top, visible });
          if (performance.now() - start < 600) requestAnimationFrame(frame);
          else (window as unknown as { __toastFrames?: typeof samples }).__toastFrames = samples;
        };
        requestAnimationFrame(frame);
      }, safe);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await page.waitForTimeout(700);
      const samples = await page.evaluate(() => (
        window as unknown as { __toastFrames?: Array<{ t: number; pad: number; covers: boolean; top: number | null; visible: boolean }> }
      ).__toastFrames);
      expect(samples).toBeTruthy();
      if (!samples || samples.length < 8) throw new Error("frame sample missed the toast");
      const finalPad = samples[samples.length - 1]?.pad ?? 0;
      const startPad = samples[0]?.pad ?? 0;
      expect(finalPad).toBeGreaterThan(startPad + 1);
      let reversals = 0;
      let peak = startPad;
      let moveStart = -1;
      let settledAt = -1;
      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1]?.pad ?? 0;
        const pad = samples[index]?.pad ?? 0;
        if (pad > peak) peak = pad;
        if (pad < previous - 1) reversals += 1;
        if (moveStart < 0 && pad > startPad + 0.5) moveStart = samples[index]?.t ?? 0;
        if (moveStart >= 0 && settledAt < 0 && Math.abs(pad - finalPad) <= 0.5) {
          const rest = samples.slice(index);
          if (rest.every((sample) => Math.abs(sample.pad - finalPad) <= 0.5)) settledAt = samples[index]?.t ?? 0;
        }
      }
      expect(reversals).toBe(0);
      expect(peak).toBeLessThanOrEqual(finalPad + 1);
      expect(settledAt).toBeGreaterThanOrEqual(0);
      expect(settledAt - Math.max(moveStart, 0)).toBeLessThanOrEqual(250);
      expect(samples.some((sample) => sample.covers)).toBe(false);
      const shown = samples.filter((sample) => sample.visible && sample.top != null);
      expect(shown.length).toBeGreaterThan(0);
      for (const sample of shown) {
        expect(sample.top ?? 0).toBeGreaterThanOrEqual(safe + 8 - 1);
      }
    });
  }
}
