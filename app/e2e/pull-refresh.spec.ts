import { expect, test, type CDPSession, type Page } from "@playwright/test";

/**
 * FLOW-1043: pull to refresh on an iPhone-sized touch screen follows a smooth curve. Every animation
 * frame logs the screen's top over a scripted pull and release; it never moves faster than 12px per
 * 60Hz frame (0.72px/ms between two samples, so a dropped frame on a busy runner is not a jump),
 * through the pull, the glide to the rest, the hold and the glide back. Chromium with an iPhone
 * viewport and touch, not WebKit: the safe area, `lvh` and Safari's touch handling are not covered.
 * The installed-app check is opted into.
 */
test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const MAX_STEP_PX = 12;
const FRAME_MS = 1000 / 60;

/** The parser replaces <html> after an init script, so the opt-in goes on once the page is up. */
async function openHome(page: Page) {
  await page.goto("/?preview=1");
  await expect(page.locator(".ui-band")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.pullRefresh = "on";
  });
}

type Sample = [time: number, top: number];

/** Logs the pulled screen's top with the frame's time on every animation frame, from now on. */
async function sample(page: Page) {
  await page.evaluate(() => {
    const log: [number, number][] = [];
    (window as unknown as { pullLog: [number, number][] }).pullLog = log;
    const box = document.querySelector(".ui-pull-screen");
    const each = (time: number) => {
      if (box != null) log.push([time, box.getBoundingClientRect().top]);
      requestAnimationFrame(each);
    };
    requestAnimationFrame(each);
  });
}

async function samples(page: Page): Promise<Sample[]> {
  return page.evaluate(() => (window as unknown as { pullLog: [number, number][] }).pullLog.slice());
}

async function nextFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => { resolve(); })));
}

/** A one-finger drag down from (200, y) by `distance` over `moves` touchmoves, one per frame. */
async function drag(page: Page, session: CDPSession, distance: number, moves: number, y = 300, id = 1) {
  const point = (yy: number) => [{ x: 200, y: Math.round(yy), id }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(y) });
  for (let step = 1; step <= moves; step += 1) {
    await nextFrame(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(y + (distance * step) / moves) });
  }
}

async function release(session: CDPSession) {
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * Each step between two samples, in px per 60Hz frame of the time between them (at least one frame:
 * a pull moves once a frame, however fast the frames come).
 */
function steps(log: Sample[]): number[] {
  return log.slice(1).map(([time, top], index) => {
    const [before, from] = log[index] ?? [time, top];
    return Math.abs(top - from) / (Math.max(time - before, FRAME_MS) / FRAME_MS);
  });
}

/** The refresh may run to its 15s cap before the glide back. */
const idle = (page: Page) => expect(page.locator(".ui-pull-screen")).not.toHaveAttribute("data-phase", { timeout: 20_000 });

test("a pull past the threshold and its release move the screen on a smooth curve", async ({ page }) => {
  await openHome(page);
  const start = await page.locator(".ui-pull-screen").evaluate((box) => box.getBoundingClientRect().top);
  await sample(page);
  const session = await page.context().newCDPSession(page);
  await drag(page, session, 180, 30);
  await expect(page.locator(".ui-pull-screen")).toHaveAttribute("data-phase", "pulling");
  await expect(page.locator(".ui-pull-spinner > line[opacity='1']")).toHaveCount(12);
  await release(session);
  await expect(page.locator(".ui-pull-screen")).toHaveAttribute("data-phase", "refreshing");
  await idle(page);
  await nextFrame(page);
  await session.detach();
  const log = await samples(page);
  const tops = log.map(([, top]) => top);
  const deepest = Math.max(...tops) - start;
  test.info().annotations.push({ type: "frames", description: `${String(log.length)} frames, deepest ${deepest.toFixed(1)}px, largest step ${Math.max(...steps(log)).toFixed(1)}px per frame` });
  expect(deepest).toBeGreaterThan(64);
  expect(tops.at(-1)).toBeCloseTo(start, 0);
  expect(Math.max(...steps(log))).toBeLessThanOrEqual(MAX_STEP_PX);
});

test("a touch during the glide back catches the screen where it is", async ({ page }) => {
  await openHome(page);
  await sample(page);
  const session = await page.context().newCDPSession(page);
  await drag(page, session, 100, 20);
  await release(session);
  await expect(page.locator(".ui-pull-screen")).toHaveAttribute("data-phase", "closing");
  await nextFrame(page);
  await nextFrame(page);
  // Still on its way back when the finger lands.
  await expect(page.locator(".ui-pull-screen")).toHaveAttribute("data-phase", "closing");
  await drag(page, session, 40, 10, 400, 2);
  await expect(page.locator(".ui-pull-screen")).toHaveAttribute("data-phase", "pulling");
  await release(session);
  await idle(page);
  await nextFrame(page);
  await session.detach();
  const log = await samples(page);
  test.info().annotations.push({ type: "frames", description: `${String(log.length)} frames, largest step ${Math.max(...steps(log)).toFixed(1)}px per frame` });
  expect(Math.max(...steps(log))).toBeLessThanOrEqual(MAX_STEP_PX);
});
