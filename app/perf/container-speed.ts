import type { Browser } from "@playwright/test";

/**
 * FLOW-816: the 0.7 s open checks failed on slow containers, not slow code. The same build opened a
 * project in 150 ms on the CI runner and 700-800 ms in some lane containers. CI keeps the bare limit.
 * A local gate times a fixed piece of work (scripting, a list's DOM and its layout) at the same CPU
 * slow-down in the same run, and scales the limit by how much slower than CI it ran, capped at 1.5.
 */

/**
 * The bench's median on the CI runner at CPU ×4, estimated: a lane container measured about 300 ms
 * (2026-10-10), and the same opens ran 3.3-3.7 times slower there than on CI (project herzl 509 vs
 * 150 ms, history 363 vs 98). CI prints its own median on every main run ("container speed: bench
 * median ... ms"); set this from that line.
 */
export const CI_BENCH_MS = 90;
export const MAX_FACTOR = 1.5;
const BENCH_RUNS = 5;

/** The fixed work, in the page: sort and serialize rows, then draw and lay out a list of them. */
function bench(): number {
  const start = performance.now();
  const rows: { id: number; name: string; amount: number }[] = [];
  for (let i = 0; i < 20_000; i += 1) rows.push({ id: i, name: `row ${String((i * 7919) % 10_007)}`, amount: (i * 31) % 997 });
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  const parsed = JSON.parse(JSON.stringify(rows)) as typeof rows;
  const list = document.createElement("ul");
  for (const row of parsed.slice(0, 1_500)) {
    const item = document.createElement("li");
    item.textContent = `${row.name} · ${String(row.amount)}`;
    list.append(item);
  }
  document.body.append(list);
  const height = list.offsetHeight;
  list.remove();
  if (height < 0) throw new Error("unreachable");
  return performance.now() - start;
}

export type ContainerSpeed = { onCi: boolean; benchMs: number; factor: number; limitMs: number; line: string };

/** The limit for this run: `limitMs` on CI, else `limitMs` × the container's slow-down against CI, capped. */
export function calibratedLimit(limitMs: number, benchMs: number, onCi: boolean): Omit<ContainerSpeed, "line"> {
  const factor = onCi ? 1 : Math.min(MAX_FACTOR, Math.max(1, benchMs / CI_BENCH_MS));
  return { onCi, benchMs, factor, limitMs: Math.round(limitMs * factor) };
}

/** Times the bench BENCH_RUNS times in a fresh page at `cpu` and returns the calibrated limit. */
export async function containerSpeed(browser: Browser, cpu: number, limitMs: number): Promise<ContainerSpeed> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const runs: number[] = [];
  for (let run = 0; run < BENCH_RUNS; run += 1) runs.push(Math.round(await page.evaluate(bench)));
  await context.close();
  const benchMs = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)] ?? CI_BENCH_MS;
  const speed = calibratedLimit(limitMs, benchMs, process.env.GITHUB_ACTIONS === "true");
  const where = speed.onCi ? "CI, bare limit" : `local, factor ${speed.factor.toFixed(2)} (cap ${String(MAX_FACTOR)})`;
  const line = `container speed: bench median ${String(benchMs)} ms (${runs.join(", ")} ms), CI ${String(CI_BENCH_MS)} ms; ${where}; limit ${String(speed.limitMs)} ms`;
  return { ...speed, line };
}
