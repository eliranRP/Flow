import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

// The approve toast (הפריט אושר, with ביטול) is the review toast the queue shows; skip is device-only and shows none.
test("an approve toast stays clear of the actions and leaves on its own", async ({ page }) => {
  await page.goto("/review?preview=1&e2e=list&rows=2");
  await expect(page.getByText("1 מתוך 2")).toBeVisible();
  const approve = page.getByRole("button", { name: "אישור" });
  await approve.click();
  const toast = page.locator(".ui-toast");
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toHaveText(/הפריט אושר/);
  await expect(page.getByRole("heading", { name: "Ridge Plumbing Co" })).toBeVisible();
  await expect(page.getByText("2 מתוך 2")).toBeVisible();

  const toastBox = await toast.boundingBox();
  const approveBox = await approve.boundingBox();
  expect(toastBox).not.toBeNull();
  expect(approveBox).not.toBeNull();
  if (toastBox == null || approveBox == null) throw new Error("toast or approve box missing");
  expect(toastBox.y + toastBox.height).toBeLessThan(approveBox.y);
  await expect(page.locator(".ui-toast-host")).toHaveCSS("pointer-events", "none");
  await expect(toast).toHaveCSS("pointer-events", "auto");
  // The undo toast lives 3s from when it is placed, so it leaves on its own well inside this wait.
  await expect(toast).toHaveCount(0, { timeout: 12_000 });
});

type ToastFrame = {
  t: number;
  pad: number;
  opacity: number;
  top: number | null;
  bottom: number | null;
  tall: boolean;
  picker: boolean;
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
  floorTop: number;
};

const GAP = 8;
/** FLOW-363 (3b): the panel holds the space above the handle, so a sheet the toast fits above keeps a 0px surface pad. */
const BASE_PAD = 0;
/** A confirmation sits --space-4 above the floor (decision 0182). */
const FLOOR_GAP = 16;

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
      // The toast rises and sinks by a transform (decision 0182): sample where it rests.
      const lift = (node: HTMLElement) => {
        const transform = getComputedStyle(node).transform;
        return transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
      };
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
        const ty = lift(toastNode);
        top = toastRect.top - ty;
        bottom = toastRect.bottom - ty;
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
        picker: sheet instanceof Element && sheet.querySelector(".ui-change-picker") != null,
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
    // The floor: a pinned bar, else the tab bar, else the screen bottom (decision 0182).
    const pinned = [...document.querySelectorAll("[data-toast-floor]")]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.height > 0)
      .map((rect) => rect.top);
    const tabBar = document.querySelector(".ui-tabbar")?.getBoundingClientRect();
    const floorTop = pinned.length > 0
      ? Math.min(...pinned)
      : tabBar && tabBar.height > 0 ? tabBar.top : window.innerHeight;
    return {
      pad: Number.parseFloat(getComputedStyle(surface).paddingTop) || 0,
      toastTop: toastRect.top,
      toastBottom: toastRect.bottom,
      sheetTop: sheet.getBoundingClientRect().top,
      closeTop: closeRect.top,
      floorTop,
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

/**
 * Decision 0182: every toast fades in over `--motion-fade` and rises 12px, so the ramp is always
 * visible in the samples, whether or not the sheet pads (0075 point 7 is about where it settles).
 */
function assertFade(samples: ToastFrame[]): void {
  const partial = samples.filter((sample) => sample.opacity > 0.05 && sample.opacity < 0.95);
  expect(partial.length).toBeGreaterThan(0);
}

function assertAboveSheet(settled: SettledToast): void {
  expect(Math.abs(settled.toastBottom - (settled.sheetTop - GAP))).toBeLessThanOrEqual(1);
  expect(Math.abs(settled.pad - BASE_PAD)).toBeLessThanOrEqual(1);
}

/** A confirmation sits --space-4 above the floor, and the sheet takes no pad for it (decision 0182). */
function assertAboveFloor(settled: SettledToast): void {
  expect(Math.abs(settled.toastBottom + FLOOR_GAP - settled.floorTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(settled.pad - BASE_PAD)).toBeLessThanOrEqual(1);
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

    test(`first show immediately after open at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await armSampler(page, safe, 1200);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertFade(samples);
      // The category picker is a fit sheet (change-sheet.tsx), so the toast sits above it with no pad.
      assertAboveSheet(settled);
      expect(samples.every((sample) => Math.abs(sample.pad - BASE_PAD) <= 1)).toBe(true);
    });

    test(`first show after the sheet settles at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await page.waitForTimeout(400);
      await armSampler(page, safe, 1200);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertAboveSheet(settled);
      assertFade(samples);
    });

    test(`retry keeps the settled geometry at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await page.waitForTimeout(400);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
      const toast = page.locator(".ui-toast");
      await expect(page.locator(".ui-toast-host")).toHaveAttribute("data-phase", "in");
      const retry = toast.getByRole("button", { name: "ניסיון חוזר", includeHidden: true });
      await expect(retry).toBeVisible();
      await armSampler(page, safe, 1000);
      await retry.click();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertAboveSheet(settled);
      const floor = Math.min(samples[0]?.pad ?? settled.pad, settled.pad);
      for (const sample of samples) {
        expect(sample.pad).toBeGreaterThanOrEqual(floor - 1);
      }
    });

    test(`tall to short keeps the confirmation above the floor at ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?item=q-bolts");
      await openCategory(page, safe);
      await page.waitForTimeout(400);
      await armSampler(page, safe, 1000);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
      await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toBeVisible();
      const samples = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(samples);
      assertFade(samples);
      // A confirmation (not a failure), so it sits above the floor and the sheet takes no pad.
      assertAboveFloor(settled);
      expect(settled.sheetTop).toBeGreaterThan(200);
    });
  }
}

for (const viewport of viewports) {
  for (const safe of [0, 20, 47] as const) {
    const label = `${String(viewport.width)}×${String(viewport.height)} safe ${String(safe)}`;

    test(`reduced motion settles without a pad blip at ${label}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.goto("/reviewer/save?save=offline");
      await openCategory(page, safe);
      await page.waitForTimeout(50);
      await armSampler(page, safe, 800);
      await page.getByRole("radio", { name: "שינוע" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
      const first = await readFrames(page);
      const settled = await readSettled(page);
      assertVisiblePosition(first);
      assertAboveSheet(settled);
      const partial = first.filter((sample) => sample.opacity > 0.02 && sample.opacity < 0.9);
      expect(partial).toHaveLength(0);
      expect(first.every((sample) => Math.abs(sample.pad - BASE_PAD) <= 1)).toBe(true);
      await armSampler(page, safe, 600);
      await page.getByRole("button", { name: "חזרה" }).click();
      await expect(page.getByRole("heading", { name: "שינוי שיוך" })).toBeVisible();
      const back = await readFrames(page);
      const above = await readSettled(page);
      const short = back.filter((sample) => !sample.tall && !sample.picker);
      expect(short.length).toBeGreaterThan(0);
      assertVisiblePosition(short);
      assertAboveSheet(above);
      expect(short.every((sample) => sample.pad <= Math.max(above.pad, BASE_PAD) + 1)).toBe(true);
    });
  }
}

for (const viewport of viewports) {
  const label = `${String(viewport.width)}×${String(viewport.height)}`;

  // FLOW-309: no real flow pads the sheet, so a test-only safe area reaching 20px past the
  // category sheet's top leaves no room above it: the toast keeps --space-2 under the safe area
  // and the sheet pads once. The pad settles before the toast shows, then the fade ramps (0075).
  // The fake inset leaves this fit sheet room to grow upward, so where ✕ ends up says nothing
  // about a real phone; the other cases check that.
  test(`a pad move settles first, then the fade ramps, at ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/reviewer/save?save=offline");
    await openCategory(page, 0);
    await page.waitForTimeout(400);
    const sheetTop = await page.evaluate(() => document.querySelector("[data-vaul-drawer][data-state='open']")?.getBoundingClientRect().top ?? 0);
    expect(sheetTop).toBeGreaterThan(100);
    const safe = Math.round(sheetTop) - 20;
    await armSampler(page, safe, 1200);
    await page.getByRole("radio", { name: "שינוע" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "שמירה", exact: true }).click();
    const samples = await readFrames(page);
    const settled = await readSettled(page);
    expect(settled.pad).toBeGreaterThan(BASE_PAD + 1);
    assertFade(samples);
    const shown = samples.findIndex((sample) => sample.opacity > 0.02);
    expect(shown).toBeGreaterThan(0);
    for (const sample of samples.slice(shown)) {
      expect(Math.abs(sample.pad - settled.pad)).toBeLessThanOrEqual(1);
      expect(Math.abs((sample.top ?? 0) - settled.toastTop)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(settled.toastTop - (safe + GAP))).toBeLessThanOrEqual(1);
  });
}
