import { expect, test, type Page } from "@playwright/test";

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
  if (toastBox == null || skipBox == null) throw new Error("toast or skip box missing");
  expect(toastBox.y + toastBox.height).toBeLessThan(skipBox.y);
  await expect(page.locator(".ui-toast-host")).toHaveCSS("pointer-events", "none");
  await expect(toast).toHaveCSS("pointer-events", "auto");

  await change.click();
  await expect(page.getByText("השינוי נפתח")).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 5_000 });
});

type ToastFrame = {
  t: number;
  pad: number;
  opacity: number;
  top: number | null;
  bottom: number | null;
  tall: boolean;
  covers: boolean;
  gapOk: boolean;
};

/**
 * Viewport client rects, origin at the layout viewport.
 * Toast: `.ui-toast`. Sheet: `[data-vaul-drawer][data-state=open]`.
 * ✕: `button[aria-label="סגירה"]` inside that sheet. Padding: `.ui-sheet-surface` padding-top.
 */
type SettledToast = {
  pad: number;
  toastTop: number;
  toastBottom: number;
  sheetTop: number;
  closeTop: number;
};

const GAP = 8;

async function setSafe(page: Page, safe: number): Promise<void> {
  await page.evaluate((inset) => {
    document.documentElement.style.setProperty("--safe-top", `${String(inset)}px`);
  }, safe);
}

async function armSampler(page: Page, safe: number, ms: number): Promise<void> {
  await page.evaluate(({ inset, duration }) => {
    document.documentElement.style.setProperty("--safe-top", `${String(inset)}px`);
    const samples: ToastFrame[] = [];
    const start = performance.now();
    const space = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) || 8;
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.width > 0 && b.width > 0
      && a.top < b.bottom - 0.5
      && a.bottom > b.top + 0.5
      && a.left < b.right - 0.5
      && a.right > b.left + 0.5;
    const frame = () => {
      const surface = document.querySelector(".ui-sheet-surface");
      const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
      const pad = surface instanceof HTMLElement ? Number.parseFloat(getComputedStyle(surface).paddingTop) || 0 : 0;
      const toastNode = document.querySelector(".ui-toast");
      let top: number | null = null;
      let bottom: number | null = null;
      let opacity = 0;
      let covers = false;
      let gapOk = true;
      const root = sheet ?? document;
      const controlRect = (label: string) => {
        const control = root.querySelector(`button[aria-label="${label}"]`)
          ?? document.querySelector(`button[aria-label="${label}"]`);
        if (!(control instanceof HTMLElement)) return null;
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        return rect;
      };
      const closeRect = controlRect("סגירה");
      const backRect = controlRect("חזרה");
      if (toastNode instanceof HTMLElement) {
        const toastStyle = getComputedStyle(toastNode);
        opacity = Number.parseFloat(toastStyle.opacity) || 0;
        const toastRect = toastNode.getBoundingClientRect();
        top = toastRect.top;
        bottom = toastRect.bottom;
        const visible = opacity > 0.02;
        if (visible) {
          if (top < inset + space - 1) gapOk = false;
          for (const rect of [closeRect, backRect]) {
            if (!rect) continue;
            if (overlaps(toastRect, rect)) covers = true;
            if (rect.top < toastRect.bottom + space - 1 && rect.bottom > toastRect.top) gapOk = false;
          }
        }
      }
      samples.push({
        t: performance.now() - start,
        pad,
        opacity,
        top,
        bottom,
        tall: sheet instanceof Element && sheet.classList.contains("ui-sheet-tall"),
        covers,
        gapOk,
      });
      if (performance.now() - start < duration) requestAnimationFrame(frame);
      else (window as unknown as { __toastFrames?: ToastFrame[] }).__toastFrames = samples;
    };
    (window as unknown as { __toastFrames?: ToastFrame[] }).__toastFrames = undefined;
    requestAnimationFrame(frame);
  }, { inset: safe, duration: ms });
}

async function readFrames(page: Page): Promise<ToastFrame[]> {
  await page.waitForFunction(() => (window as unknown as { __toastFrames?: ToastFrame[] }).__toastFrames != null);
  const samples = await page.evaluate(() => (window as unknown as { __toastFrames?: ToastFrame[] }).__toastFrames);
  if (!samples || samples.length < 8) throw new Error("frame sample missed the toast");
  return samples;
}

async function readSettled(page: Page): Promise<SettledToast> {
  await expect(page.locator(".ui-toast-host")).toHaveAttribute("data-phase", "in");
  await page.waitForFunction(() => {
    const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
    if (!(sheet instanceof HTMLElement)) return false;
    const transform = getComputedStyle(sheet).transform;
    const still = transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
    return still && sheet.scrollTop === 0;
  });
  return page.evaluate(() => {
    const toast = document.querySelector(".ui-toast");
    const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
    const surface = document.querySelector(".ui-sheet-surface");
    const close = sheet?.querySelector("button[aria-label='סגירה']");
    if (!(toast instanceof HTMLElement) || !(sheet instanceof HTMLElement) || !(surface instanceof HTMLElement) || !(close instanceof HTMLElement)) {
      throw new Error("settled toast geometry is missing");
    }
    const toastRect = toast.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    return {
      pad: Number.parseFloat(getComputedStyle(surface).paddingTop) || 0,
      toastTop: toastRect.top,
      toastBottom: toastRect.bottom,
      sheetTop: sheet.getBoundingClientRect().top,
      closeTop: closeRect.top,
    };
  });
}

function assertVisiblePosition(samples: ToastFrame[]): void {
  const shown = samples.filter((sample) => sample.opacity > 0.02 && sample.top != null);
  expect(shown.length).toBeGreaterThan(0);
  const finalTop = shown[shown.length - 1]?.top ?? 0;
  for (const sample of shown) {
    expect(Math.abs((sample.top ?? 0) - finalTop)).toBeLessThanOrEqual(1);
  }
  expect(samples.some((sample) => sample.covers)).toBe(false);
  expect(samples.every((sample) => sample.gapOk)).toBe(true);
}

function assertPadGeometry(settled: SettledToast, padNeeded: boolean): void {
  if (padNeeded) {
    expect(settled.pad).toBeGreaterThan(GAP + 1);
    expect(Math.abs(settled.closeTop - (settled.toastBottom + GAP))).toBeLessThanOrEqual(1);
    return;
  }
  expect(Math.abs(settled.pad - GAP)).toBeLessThanOrEqual(1);
}

function assertAboveSheet(settled: SettledToast): void {
  expect(Math.abs(settled.toastBottom - (settled.sheetTop - GAP))).toBeLessThanOrEqual(1);
  expect(Math.abs(settled.pad - GAP)).toBeLessThanOrEqual(1);
}

function padMove(samples: ToastFrame[]): { start: number; final: number; moveStart: number; settledAt: number; reversals: number; peak: number } {
  const final = samples[samples.length - 1]?.pad ?? 0;
  const start = samples[0]?.pad ?? 0;
  let reversals = 0;
  let peak = start;
  let moveStart = -1;
  let settledAt = -1;
  const fadeAt = samples.find((sample) => sample.opacity > 0.02)?.t ?? -1;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]?.pad ?? 0;
    const pad = samples[index]?.pad ?? 0;
    if (pad > peak) peak = pad;
    if (pad < previous - 1) reversals += 1;
    if (moveStart < 0 && pad > start + 0.5) moveStart = samples[index]?.t ?? 0;
  }
  if (moveStart >= 0 && fadeAt >= moveStart) settledAt = fadeAt;
  return { start, final, moveStart, settledAt, reversals, peak };
}

async function openCategory(page: Page, safe: number): Promise<void> {
  await setSafe(page, safe);
  await page.getByRole("button", { name: /קטגוריה:/ }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
}

const viewports = [
  { width: 320, height: 693 },
  { width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  for (const safe of [0, 20, 47] as const) {
    const label = `${String(viewport.width)}×${String(viewport.height)} safe ${String(safe)}`;
    const padNeeded = safe === 47;

    test(`first show immediately after open at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await armSampler(page, safe, 1200);
      await page.getByRole("radio", { name: "שינוע" }).click();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertPadGeometry(settled, padNeeded);
      if (!padNeeded) return;
      const move = padMove(samples);
      expect(move.final).toBeGreaterThan(move.start + 1);
      expect(move.reversals).toBe(0);
      expect(move.peak).toBeLessThanOrEqual(move.final + 1);
      const duration = move.settledAt - Math.max(move.moveStart, 0);
      expect(duration).toBeGreaterThanOrEqual(150);
      expect(duration).toBeLessThanOrEqual(250);
      expect(samples.some((sample) => sample.pad > move.start + 1 && sample.pad < move.final - 1)).toBe(true);
      const before = samples.filter((sample) => sample.t < move.settledAt - 16);
      expect(before.every((sample) => sample.opacity <= 0.02)).toBe(true);
    });

    test(`first show after the sheet settles at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await page.waitForTimeout(400);
      await armSampler(page, safe, 1200);
      await page.getByRole("radio", { name: "שינוע" }).click();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertPadGeometry(settled, padNeeded);
    });

    test(`retry keeps the settled geometry at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await page.waitForTimeout(400);
      await page.getByRole("radio", { name: "שינוע" }).click();
      const toast = page.locator(".ui-toast");
      await expect(page.locator(".ui-toast-host")).toHaveAttribute("data-phase", "in");
      const retry = toast.getByRole("button", { name: "ניסיון חוזר", includeHidden: true });
      await expect(retry).toBeVisible();
      await armSampler(page, safe, 1000);
      await retry.click();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertPadGeometry(settled, padNeeded);
      const floor = Math.min(samples[0]?.pad ?? settled.pad, settled.pad);
      for (const sample of samples) {
        expect(sample.pad).toBeGreaterThanOrEqual(floor - 1);
      }
    });

    test(`tall to short keeps the confirmation under the header at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?item=q-bolts");
      await openCategory(page, safe);
      await page.waitForTimeout(400);
      await armSampler(page, safe, 1000);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toBeVisible();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      const underHeader = await page.evaluate((inset) => {
        const header = document.querySelector("header.ui-page, header.ui-band");
        const space = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-4")) || 16;
        if (header instanceof HTMLElement && header.getBoundingClientRect().height > 0) {
          const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) || 8;
          return header.getBoundingClientRect().bottom + gap;
        }
        return inset + space;
      }, safe);
      expect(Math.abs(settled.toastTop - underHeader)).toBeLessThanOrEqual(1);
      expect(settled.toastBottom + GAP).toBeLessThanOrEqual(settled.closeTop + 1);
      expect(settled.sheetTop).toBeGreaterThan(200);
    });
  }
}

for (const viewport of viewports) {
  for (const safe of [0, 20, 47] as const) {
    const label = `${String(viewport.width)}×${String(viewport.height)} safe ${String(safe)}`;
    const padNeeded = safe === 47;

    test(`reduced motion settles without a pad blip at ${label}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await page.waitForTimeout(50);
      await armSampler(page, safe, 800);
      await page.getByRole("radio", { name: "שינוע" }).click();
      const first = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(first);
      assertPadGeometry(settled, padNeeded);
      const partial = first.filter((sample) => sample.opacity > 0.02 && sample.opacity < 0.9);
      expect(partial).toHaveLength(0);
      if (padNeeded) {
        const move = padMove(first);
        expect(move.settledAt - Math.max(move.moveStart, 0)).toBeLessThan(50);
      } else {
        expect(first.every((sample) => Math.abs(sample.pad - GAP) <= 1)).toBe(true);
      }
      await armSampler(page, safe, 600);
      await page.getByRole("button", { name: "חזרה" }).click();
      await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toBeVisible();
      const back = await readFrames(page);
      const above = await readSettled(page);
      const short = back.filter((sample) => !sample.tall);
      expect(short.length).toBeGreaterThan(0);
      assertVisiblePosition(short);
      assertAboveSheet(above);
      expect(short.every((sample) => sample.pad <= Math.max(above.pad, GAP) + 1)).toBe(true);
    });
  }
}
