#!/usr/bin/env node
// Gate-times report: how long the pre-push gate (scripts/local-ci.sh) took, by diff kind, against the owner's
// targets (2026-10-09): a UI diff gates in under 3 minutes, a server diff under 5, a migration under 10.
// Reads gate-times.log, one tab-separated line per run: time, branch, mode, kind, seconds, result, phases
// ("lint-build=40 units=95"). Lines in an older shape are skipped.
// Usage: node scripts/gate-times.mjs [--since <ISO time>] [--file <path>] [--json]
//   --since defaults to 3 hours ago; --file to /mnt/project-files/ci/gate-times.log.
// The lane manager runs it every hour next to scripts/merge-cycle.mjs.
import { readFileSync } from "node:fs";
import process from "node:process";

/** Target seconds per diff kind; docs and scripts have none. */
export const TARGETS = { ui: 180, server: 300, migration: 600 };
const KINDS = ["ui", "server", "migration", "scripts", "docs", "unknown"];

/** One run from a log line, or null for a line in another shape. */
export function parseLine(line) {
  const cells = line.split("\t");
  if (cells.length !== 7) return null;
  const [at, branch, mode, kind, seconds, result, phases] = cells;
  if (!/^\d+$/.test(seconds) || Number.isNaN(Date.parse(at))) return null;
  const parts = {};
  for (const pair of phases.split(" ").filter(Boolean)) {
    const [name, value] = pair.split("=");
    if (name && /^\d+$/.test(value ?? "")) parts[name] = (parts[name] ?? 0) + Number(value);
  }
  return { at, branch, mode, kind, seconds: Number(seconds), passed: result === "pass", parts };
}

/** The lower middle of a list of numbers, 0 for none. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
}

/** Runs at or after `since`, grouped by kind: count, passes, median seconds, target, met, and median per phase. */
export function summarize(runs, since) {
  const sinceMs = Date.parse(since);
  const byKind = {};
  for (const run of runs) {
    if (Date.parse(run.at) < sinceMs) continue;
    const bucket = (byKind[run.kind] ??= { runs: [], phases: {} });
    bucket.runs.push(run);
    for (const [name, seconds] of Object.entries(run.parts)) (bucket.phases[name] ??= []).push(seconds);
  }
  const out = {};
  for (const [kind, bucket] of Object.entries(byKind)) {
    const target = TARGETS[kind] ?? null;
    const seconds = bucket.runs.map((run) => run.seconds);
    out[kind] = {
      gates: bucket.runs.length,
      passed: bucket.runs.filter((run) => run.passed).length,
      median: median(seconds),
      target,
      met: target == null ? null : seconds.filter((value) => value <= target).length,
      phases: Object.fromEntries(Object.entries(bucket.phases).map(([name, values]) => [name, median(values)])),
    };
  }
  return out;
}

/** The report as text: one line per kind, slowest phases first. */
export function format(summary) {
  const lines = ["kind      | gates | passed | median s | target s | met | median s per phase"];
  const kinds = Object.keys(summary).sort((a, b) => KINDS.indexOf(a) - KINDS.indexOf(b));
  for (const kind of kinds) {
    const row = summary[kind];
    const phases = Object.entries(row.phases)
      .sort((a, b) => b[1] - a[1])
      .map(([name, seconds]) => `${name} ${seconds}`)
      .join(", ");
    lines.push(
      `${kind.padEnd(9)} | ${String(row.gates).padStart(5)} | ${String(row.passed).padStart(6)} | ${String(row.median).padStart(8)} | ` +
        `${String(row.target ?? "—").padStart(8)} | ${row.met == null ? "  —" : `${row.met}/${row.gates}`.padStart(3)} | ${phases}`,
    );
  }
  if (kinds.length === 0) lines.push("no gate runs in the window");
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const since = value("--since", new Date(Date.now() - 3 * 3600 * 1000).toISOString());
  const file = value("--file", "/mnt/project-files/ci/gate-times.log");
  if (Number.isNaN(Date.parse(since))) throw new Error(`--since is not a time: ${since}`);
  const runs = readFileSync(file, "utf8").split("\n").map(parseLine).filter((run) => run != null);
  const summary = summarize(runs, since);
  console.log(args.includes("--json") ? JSON.stringify({ since, summary }, null, 2) : `Gate times since ${since}\n${format(summary)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
