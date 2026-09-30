import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { stampBuild } from "./stamp-build.mjs";

const sha = "8fbc564e2278f9c8ce12b55d663ab37e6b7019a6";

test("stamps build.txt and the hosted html", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "flow-stamp-"));
  writeFileSync(path.join(dist, "index.html"), "<head><title>Flow</title></head><body></body>");
  writeFileSync(path.join(dist, "404.html"), "<head></head>");
  stampBuild(dist, sha);
  assert.equal(readFileSync(path.join(dist, "build.txt"), "utf8"), `${sha}\n`);
  assert.match(readFileSync(path.join(dist, "index.html"), "utf8"), new RegExp(`name="flow-build" content="${sha}"`));
  assert.match(readFileSync(path.join(dist, "404.html"), "utf8"), new RegExp(`name="flow-build" content="${sha}"`));
  stampBuild(dist, sha);
  assert.equal(readFileSync(path.join(dist, "index.html"), "utf8").match(/flow-build/g)?.length, 1);
});

test("rejects a missing dist and a short sha", () => {
  assert.throws(() => stampBuild(path.join(tmpdir(), "flow-stamp-missing"), sha), /missing/);
  const dist = mkdtempSync(path.join(tmpdir(), "flow-stamp-"));
  assert.throws(() => stampBuild(dist, "8fbc564"), /40-character/);
});
