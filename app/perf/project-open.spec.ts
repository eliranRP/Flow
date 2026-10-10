import { expect, test, type Page } from "@playwright/test";
import { median, RUNS, runsLine } from "./runs";
import { stubBackend } from "./stub-backend";

/**
 * FLOW-804, the owner's ask of 2026-10-09: a project opens in under 0.7 s after a tap. This signs in
 * against the stub backend (the demo books), opens פרויקטים on the production build, and taps a
 * project row at CPU ×4, the mid-range phone of the Home test. The stub answers at once, so this
 * times the page's code and its render, not the server's read. Each project takes the median of 5.
 */
const CPU = 4;
const LIMIT_MS = 700;

const projects = [
  { id: "herzl", name: "שיפוץ הרצל 12" },
  { id: "levi", name: "שיפוץ מטבח ואמבטיה - לוי רעננה" },
] as const;

async function openProjects(page: Page) {
  await page.goto("/projects");
  await expect(page.locator('a[href^="/projects/"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("a project page opens within 0.7 s of a tap on its row on a mid-range phone", async ({ browser }) => {
  test.setTimeout(180_000);
  const lines: string[] = [];
  const slow: string[] = [];
  for (const { id, name } of projects) {
    const runs: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const stub = await stubBackend(page);
      await openProjects(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
      const start = Date.now();
      await page.locator(`a[href="/projects/${id}"]`).tap();
      await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible({ timeout: 10_000 });
      // The page's own read has come back and rendered, not just the row's name from the list.
      // Poll every 10 ms: expect.poll's default steps (100, 250, 500 ms) put up to 350 ms of waiting into
      // the time, which made the median swing across the limit from run to run.
      await expect.poll(() => stub.rpcs.includes("get_project"), { intervals: [10] }).toBe(true);
      await expect.poll(stub.inflight, { intervals: [10] }).toBe(0);
      runs.push(Date.now() - start);
      await context.close();
    }
    lines.push(runsLine(id, runs));
    if (median(runs) > LIMIT_MS) slow.push(id);
  }
  const summary = `${lines.join("; ")}; limit ${String(LIMIT_MS)} ms`;
  test.info().annotations.push({ type: "project-open", description: summary });
  console.log(summary);
  expect(slow, summary).toEqual([]);
});
