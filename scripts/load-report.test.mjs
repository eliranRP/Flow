import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { allowance, compare, sizes, table } from "./load-report.mjs";

test("sizes reads what index.html loads up front, apart from the lazy chunks", () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), "flow-load-test-"));
  try {
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), '<script type="module" src="/assets/index-a.js"></script><link rel="stylesheet" href="/assets/index-b.css">');
    writeFileSync(path.join(dist, "assets/index-a.js"), "x".repeat(4000));
    writeFileSync(path.join(dist, "assets/lazy-c.js"), "y".repeat(9000));
    writeFileSync(path.join(dist, "assets/index-b.css"), ".a{}");
    const measured = sizes(dist);
    assert.equal(measured.entryJsRaw, 4000);
    assert.equal(measured.chunks, 2);
    assert.ok(measured.entryJsGzip > 0 && measured.entryJsGzip < measured.totalJsGzip);
    assert.ok(measured.entryCssGzip > 0);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("a size fails only past its allowance, and a smaller one is an improvement", () => {
  const base = { entryJsGzip: 100_000, entryCssGzip: 20_000, entryJsRaw: 400_000, totalJsGzip: 300_000, chunks: 80 };
  assert.deepEqual(compare(base, { ...base, entryJsGzip: base.entryJsGzip + allowance.entryJsGzip }).regressions, []);
  assert.deepEqual(compare(base, { ...base, entryJsGzip: 90_000, chunks: 81 }).regressions, []);
  assert.match(compare(base, { ...base, entryJsGzip: base.entryJsGzip + allowance.entryJsGzip + 1 }).regressions[0], /^entryJsGzip grew by 2\.0 KB/);
  assert.match(table(compare(base, { ...base, entryJsGzip: 90_000 }).rows), /\| entryJsGzip \| 97\.7 KB \| 87\.9 KB \| −9\.8 KB \|/);
});

test("speed fails only when the branch is slower in most paired runs and past both limits", () => {
  const base = { homeReadyMs: 1000 };
  assert.equal(compare(base, { homeReadyMs: 1300, slowerShare: 0.6 }).regressions.length, 0);
  assert.equal(compare(base, { homeReadyMs: 1090, slowerShare: 1 }).regressions.length, 0);
  assert.match(compare(base, { homeReadyMs: 1300, slowerShare: 0.8 }).regressions[0], /^homeReadyMs grew by 300 ms \(30%\), slower in 80% of paired runs\./);
});
