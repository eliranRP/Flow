/**
 * FLOW-912: one rule for every timed open. A single open on a shared machine swings by 300 ms or
 * more, so each check opens RUNS times and holds the median to its limit, and its line keeps every
 * open's time so a real slowdown (all opens up) reads apart from one slow open.
 */
export const RUNS = 5;

/** The middle time of the opens; with none, a time that fails any limit. */
export function median(runs: readonly number[]): number {
  const sorted = [...runs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

/** "label: median X ms (a, b, c, d, e ms)", the opens in the order they ran. */
export function runsLine(label: string, runs: readonly number[]): string {
  return `${label}: median ${String(median(runs))} ms (${runs.join(", ")} ms)`;
}
