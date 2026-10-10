import { expect, test, type Page } from "@playwright/test";
import { median, RUNS, runsLine } from "./runs";

/**
 * FLOW-804, the owner's ask of 2026-10-09: projects and the pages inside the app open in under
 * 0.7 s after a tap. This runs on the production build at CPU ×4 (the mid-range phone of the Home
 * test), once Home has settled and its idle preload has fetched the other screens, as on a phone
 * that has been open a moment. The page is in preview, so this times the screen's code and its
 * first render; the data read is not part of it. Each tap takes the median of 5 tries.
 */
const CPU = 4;
const LIMIT_MS = 700;

const taps = [
  { tab: "פרויקטים", heading: "פרויקטים" },
  { tab: "לאישור", heading: "לאישור" },
  { tab: "הגדרות", heading: "הגדרות" },
] as const;

async function openHome(page: Page) {
  await page.goto("/?preview=1");
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("projects and inner pages open within 0.7 s of a tap on a mid-range phone", async ({ browser }) => {
  test.setTimeout(180_000);
  const lines: string[] = [];
  const slow: string[] = [];
  for (const { tab, heading } of taps) {
    const runs: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await openHome(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
      const link = page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: tab, exact: false });
      const start = Date.now();
      await link.tap();
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible({ timeout: 10_000 });
      runs.push(Date.now() - start);
      await context.close();
    }
    lines.push(runsLine(tab, runs));
    if (median(runs) > LIMIT_MS) slow.push(tab);
  }
  const summary = `${lines.join("; ")}; limit ${String(LIMIT_MS)} ms`;
  test.info().annotations.push({ type: "page-open", description: summary });
  console.log(summary);
  expect(slow, summary).toEqual([]);
});
