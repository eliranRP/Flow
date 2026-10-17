import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { coverage, parseArgs, readMaps, report } from "./board-coverage.mjs";

const canvas = {
  pages: [{ id: "explore" }, { id: "ready" }, { id: "light" }],
  boards: {
    "A.dc.html": { page: "ready" },
    "ALight.dc.html": { page: "light" },
    "B.dc.html": { page: "ready" },
    "BLight.dc.html": { page: "light" },
    "X.dc.html": { page: "explore" },
  },
};

test("parses the project and the maps folder, which defaults to design/proof", () => {
  assert.deepEqual(parseArgs(["--project", "p"]), { project: "p", maps: "design/proof" });
  assert.deepEqual(parseArgs(["--project", "p", "--maps", "m"]), { project: "p", maps: "m" });
  assert.throws(() => parseArgs([]), /--project is required/);
  assert.throws(() => parseArgs(["--project", "p", "--width", "1"]), /unknown option --width/);
  assert.throws(() => parseArgs(["--project", "p", "--maps"]), /--maps needs a value/);
});

test("lists the board frames that no map names, and the stale map keys", () => {
  const result = coverage(canvas, { "x-map.json": { A: "/a", Z: "/z" } });
  assert.deepEqual(result, {
    frames: ["A", "B"],
    mapped: ["A"],
    missing: ["B"],
    stale: ["Z"],
    duplicates: [],
  });
});

test("a frame named by two map files is a duplicate", () => {
  const result = coverage(canvas, { "a-map.json": { A: "/a" }, "b-map.json": { A: "/a2", B: "/b" } });
  assert.deepEqual(result.duplicates, ["A"]);
  assert.deepEqual(result.mapped, ["A", "B"]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.stale, []);
});

test("a map that lists a frame once is not a duplicate of itself", () => {
  assert.deepEqual(coverage(canvas, { "a-map.json": { A: "/a" } }).duplicates, []);
});

test("the report gives the counts first, then the blocks that have entries", () => {
  assert.equal(
    report(coverage(canvas, { "x-map.json": { A: "/a", Z: "/z" } })),
    "board frames: 2, mapped: 1, missing: 1\nmissing:\n  B\nstale:\n  Z\n",
  );
  assert.equal(
    report(coverage(canvas, { "a-map.json": { A: "/a" }, "b-map.json": { A: "/a", B: "/b" } })),
    "board frames: 2, mapped: 2, missing: 0\nmissing:\nduplicates:\n  A\n",
  );
});

test("reads every map file in name order and skips the other files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "board-coverage-"));
  writeFileSync(path.join(dir, "b-map.json"), '{ "B": "/b" }\n');
  writeFileSync(path.join(dir, "a-map.json"), '{ "A": "/a" }\n');
  writeFileSync(path.join(dir, "notes.md"), "not a map\n");
  assert.deepEqual(readMaps(dir), { "a-map.json": { A: "/a" }, "b-map.json": { B: "/b" } });
  writeFileSync(path.join(dir, "c-map.json"), "[]\n");
  assert.throws(() => readMaps(dir), /c-map\.json must be a JSON object/);
});
