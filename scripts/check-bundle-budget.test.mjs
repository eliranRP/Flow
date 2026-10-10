import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { entryFiles, gzipBytes, measure, overBudget } from "./check-bundle-budget.mjs";

const script = fileURLToPath(new URL("./check-bundle-budget.mjs", import.meta.url));

function dist(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-"));
  mkdirSync(path.join(dir, "assets"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}

const html = `<!doctype html><html><head>
<link rel="icon" href="/favicon.svg" />
<script type="module" crossorigin src="/assets/index-a.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-b.js">
<link rel="stylesheet" crossorigin href="/assets/index-c.css">
<link rel="manifest" href="/manifest.webmanifest">
<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>
<script type="module" src="https://cdn.example.com/x.js"></script>
</head></html>`;

test("entryFiles takes module scripts, module preloads and stylesheets, nothing else", () => {
  assert.deepEqual(entryFiles(html), ["assets/index-a.js", "assets/vendor-b.js", "assets/index-c.css"]);
});

test("measure sums the entry files and every JavaScript file", () => {
  const a = "a".repeat(5000);
  const b = "console.log(1);".repeat(300);
  const lazy = "export const x = 1;".repeat(200);
  const dir = dist({
    "index.html": html,
    "assets/index-a.js": a,
    "assets/vendor-b.js": b,
    "assets/index-c.css": "body{}",
    "assets/screen-d.js": lazy,
  });
  const sizes = measure(dir);
  assert.equal(sizes.entryGzip, gzipBytes(a) + gzipBytes(b) + gzipBytes("body{}"));
  assert.equal(sizes.totalJsGzip, gzipBytes(a) + gzipBytes(b) + gzipBytes(lazy));
});

test("overBudget names each limit passed", () => {
  const budget = { homeEntryGzipKB: 1, totalJsGzipKB: 2 };
  assert.deepEqual(overBudget({ entryGzip: 1024, totalJsGzip: 2048 }, budget), []);
  const over = overBudget({ entryGzip: 1025, totalJsGzip: 2049 }, budget);
  assert.equal(over.length, 2);
  assert.match(over[0], /Home entry is 1\.0 KB gzip, over its 1 KB budget/);
  assert.match(over[1], /All JavaScript/);
});

test("the CLI fails over budget and when there is no build", () => {
  const big = dist({
    "index.html": '<script type="module" src="/assets/index-a.js"></script>',
    // Random bytes barely compress, so 300 KB stays over the Home entry budget.
    "assets/index-a.js": Buffer.from(Array.from({ length: 300 * 1024 }, () => Math.floor(Math.random() * 256))),
  });
  assert.throws(() => execFileSync("node", [script, big], { stdio: "pipe" }), (error) => error.status === 1);
  const empty = mkdtempSync(path.join(tmpdir(), "budget-"));
  assert.throws(() => execFileSync("node", [script, empty], { stdio: "pipe" }), (error) => error.status === 2);
  const small = dist({ "index.html": '<script type="module" src="/assets/index-a.js"></script>', "assets/index-a.js": "x" });
  assert.match(execFileSync("node", [script, small], { encoding: "utf8" }), /Home entry 0\.0 \/ \d+ KB gzip/);
});
