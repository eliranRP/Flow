import { expect, test, type Browser } from "@playwright/test";
import { median, RUNS, runsLine } from "./runs";
import { stubBackend } from "./stub-backend";

/**
 * FLOW-804, the owner's ask of 2026-10-09 with the database staying on Micro (2026-10-10): through
 * REST every read pays a 150 to 500 ms floor plus 1 to 4 s spikes. A project opened before paints
 * from its last read saved on the phone, so a repeat open, after a reload too, shows its figures
 * within 0.7 s of the tap even while the server takes 2 s, and the fresh read lands behind it.
 * Production build, CPU ×4, the median of 5.
 */
const CPU = 4;
const LIMIT_MS = 700;
/** A spike: the project's read takes this long; every other read pays the REST floor. */
const SPIKE_MS = Number(process.env.FLOW_PERF_SPIKE_MS ?? 2_000);
const FLOOR_MS = 300;
const project = { id: "herzl", name: "שיפוץ הרצל 12" } as const;

async function timedOpen(browser: Browser, warm: boolean): Promise<{ ms: number; early: string[]; late: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  let slow = false;
  const stub = await stubBackend(page, { delay: (rpc) => (slow && rpc === "get_project" ? SPIKE_MS : slow ? FLOOR_MS : 0) });
  const row = page.locator(`a[href="/projects/${project.id}"]`);
  if (warm) {
    // An earlier visit: the project was opened once, then the app was closed.
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("heading", { level: 1, name: project.name, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(stub.inflight).toBe(0);
    // That visit was an hour ago, so its saved read is stale and is read again (project-cache.ts).
    await page.evaluate(() => {
      const raw = localStorage.getItem("flow-project-reads");
      if (raw == null) throw new Error("no saved project read");
      const saved = JSON.parse(raw) as { entries: { at: number }[] };
      for (const entry of saved.entries) entry.at -= 3_600_000;
      localStorage.setItem("flow-project-reads", JSON.stringify(saved));
    });
  }
  await page.goto("/projects");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  slow = true;
  const before = stub.reads.length;
  const start = Date.now();
  await row.tap();
  await expect(page.getByRole("heading", { level: 1, name: project.name, exact: true })).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - start;
  // The fresh read still goes out and lands behind the saved figures.
  await expect.poll(() => stub.reads.slice(before).some((read) => read.name === "get_project")).toBe(true);
  await expect.poll(stub.inflight, { timeout: 10_000 }).toBe(0);
  // Let any read that waits for the project's read go out too, then sort the open's reads by
  // whether they were asked while the project's read was still out (they share the server).
  await page.waitForTimeout(500);
  await expect.poll(stub.inflight, { timeout: 10_000 }).toBe(0);
  const opened = stub.reads.slice(before);
  const landed = opened.find((read) => read.name === "get_project")?.answered ?? Number.POSITIVE_INFINITY;
  const others = opened.filter((read) => read.name !== "get_project");
  const early = others.filter((read) => read.asked < landed).map((read) => read.name);
  const late = others.filter((read) => read.asked >= landed).map((read) => read.name);
  await context.close();
  return { ms, early, late };
}

test("a project opened before paints within 0.7 s of a tap while the server spikes", async ({ browser }) => {
  test.setTimeout(240_000);
  const lines: string[] = [];
  const medians: Record<string, number> = {};
  for (const warm of [false, true]) {
    const runs: number[] = [];
    let reads = "";
    for (let run = 0; run < RUNS; run += 1) {
      const result = await timedOpen(browser, warm);
      runs.push(result.ms);
      reads = `beside get_project ${result.early.join(" ") || "none"}, after it ${result.late.join(" ") || "none"}`;
    }
    const label = warm ? "opened before" : "first open";
    medians[label] = median(runs);
    lines.push(`${runsLine(label, runs)}, reads ${reads}`);
  }
  const summary = `${lines.join("; ")}; get_project ${String(SPIKE_MS)} ms, other reads ${String(FLOOR_MS)} ms; limit ${String(LIMIT_MS)} ms`;
  test.info().annotations.push({ type: "project-reopen", description: summary });
  console.log(summary);
  expect(medians["opened before"], summary).toBeLessThanOrEqual(LIMIT_MS);
});
