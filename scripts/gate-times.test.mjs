import assert from "node:assert/strict";
import { test } from "node:test";
import { format, parseLine, summarize } from "./gate-times.mjs";

const line = (at, kind, seconds, result, phases) =>
  [at, "flow-1-x", "default", kind, String(seconds), result, phases].join("\t");

test("parseLine reads a run, sums a repeated phase, and skips other shapes", () => {
  assert.deepEqual(parseLine(line("2026-10-09T20:00:00Z", "ui", 150, "pass", "lint-build=40 units=60 e2e=30 e2e=20")), {
    at: "2026-10-09T20:00:00Z",
    branch: "flow-1-x",
    mode: "default",
    kind: "ui",
    seconds: 150,
    passed: true,
    parts: { "lint-build": 40, units: 60, e2e: 50 },
  });
  assert.equal(parseLine("2026-10-09T19:44:13Z\tb\tdefault\t543s\tpass\t6s lint and check"), null);
  assert.equal(parseLine(""), null);
  assert.equal(parseLine(line("not a time", "ui", 1, "pass", "")), null);
});

test("summarize groups by kind in the window, against the targets", () => {
  const runs = [
    line("2026-10-09T17:00:00Z", "ui", 999, "pass", "units=999"),
    line("2026-10-09T20:00:00Z", "ui", 120, "pass", "lint-build=40 units=60"),
    line("2026-10-09T20:05:00Z", "ui", 200, "fail 1", "lint-build=50 units=120"),
    line("2026-10-09T20:10:00Z", "ui", 170, "pass", "lint-build=45 units=90"),
    line("2026-10-09T20:15:00Z", "migration", 500, "pass", "pgtap=200"),
    line("2026-10-09T20:20:00Z", "docs", 20, "pass", "lint=15"),
  ].map(parseLine);
  const summary = summarize(runs, "2026-10-09T19:00:00Z");
  assert.deepEqual(summary.ui, {
    gates: 3,
    passed: 2,
    median: 170,
    target: 180,
    met: 2,
    phases: { "lint-build": 45, units: 90 },
  });
  assert.equal(summary.migration.met, 1);
  assert.equal(summary.docs.target, null);
  assert.equal(summary.docs.met, null);
});

test("format prints one row per kind, slowest phase first", () => {
  const summary = summarize([parseLine(line("2026-10-09T20:00:00Z", "server", 320, "pass", "lint-build=40 units=200"))], "2026-10-09T19:00:00Z");
  const text = format(summary);
  assert.match(text, /^kind/);
  assert.match(text, /server\s+\|\s+1 \|\s+1 \|\s+320 \|\s+300 \| 0\/1 \| units 200, lint-build 40/);
  assert.match(format({}), /no gate runs in the window/);
});
