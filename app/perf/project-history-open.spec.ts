import { expect, test, type Page } from "@playwright/test";
import { median, RUNS, runsLine } from "./runs";
import { stubBackend } from "./stub-backend";

/**
 * FLOW-435 (the owner's 0.7 s target of 2026-10-09): the project page's "לכל החודשים" opens the
 * project's cash history in under 0.7 s after a tap. This signs in against the stub backend, opens
 * a project on the production build, and taps the link at CPU ×4, the mid-range phone of the Home
 * test. The stub answers at once, so this times the page's code and its render. Median of 5.
 */
const CPU = 4;
const LIMIT_MS = 700;

async function openProject(page: Page) {
  await page.goto("/projects/herzl");
  await expect(page.getByRole("link", { name: "לכל החודשים" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("a project's cash history opens within 0.7 s of a tap on a mid-range phone", async ({ browser }) => {
  test.setTimeout(180_000);
  const runs: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const stub = await stubBackend(page);
    await openProject(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    const start = Date.now();
    await page.getByRole("link", { name: "לכל החודשים" }).tap();
    await expect(page.getByRole("heading", { name: "שנים", exact: true })).toBeVisible({ timeout: 10_000 });
    // Poll every 10 ms: expect.poll's default steps (100, 250, 500 ms) put up to 350 ms of waiting into
    // the time, which made the median swing across the limit from run to run.
    await expect.poll(() => stub.rpcs.includes("project_cash_years"), { intervals: [10] }).toBe(true);
    await expect.poll(stub.inflight, { intervals: [10] }).toBe(0);
    runs.push(Date.now() - start);
    await context.close();
  }
  const summary = `${runsLine("project history", runs)}; limit ${String(LIMIT_MS)} ms`;
  test.info().annotations.push({ type: "project-history-open", description: summary });
  console.log(summary);
  expect(median(runs), summary).toBeLessThanOrEqual(LIMIT_MS);
});
