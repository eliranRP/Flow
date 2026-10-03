import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { jevBundleViolations, SECRET_LINE } from "./check-jev-bundle.mjs";

const script = fileURLToPath(new URL("./check-jev-bundle.mjs", import.meta.url));

test("a clean bundle passes and a needle fails", () => {
  const clean = mkdtempSync(path.join(tmpdir(), "jev-clean-"));
  mkdirSync(path.join(clean, "assets"));
  writeFileSync(path.join(clean, "assets", "index.js"), "formatIls\nJev stays off\nvault door\n");
  assert.deepEqual(jevBundleViolations(clean), []);

  const dirty = mkdtempSync(path.join(tmpdir(), "jev-dirty-"));
  writeFileSync(path.join(dirty, "app.js"), "const name = 'jev_api_key';");
  const found = jevBundleViolations(dirty);
  assert.equal(found.length, 1);
  assert.match(found[0], /jev_api_key/);
});

test("the script exit codes are 0, 1, 2, and 3", () => {
  const clean = mkdtempSync(path.join(tmpdir(), "jev-exit-clean-"));
  writeFileSync(path.join(clean, "index.js"), "export const label = 'review';\n");
  const cleanRun = run([clean]);
  assert.equal(cleanRun.status, 0);
  assert.match(cleanRun.stdout, new RegExp(SECRET_LINE));
  assert.match(cleanRun.stdout, /clean /);

  const dirty = mkdtempSync(path.join(tmpdir(), "jev-exit-dirty-"));
  writeFileSync(path.join(dirty, "index.js"), "read_jev_api_key");
  const dirtyRun = run([dirty]);
  assert.equal(dirtyRun.status, 1);
  assert.match(dirtyRun.stderr, /read_jev_api_key/);
  assert.match(dirtyRun.stdout, new RegExp(SECRET_LINE));
  assert.doesNotMatch(dirtyRun.stderr, /BEGIN PRIVATE KEY/);

  const missing = run([path.join(tmpdir(), "jev-missing-dist")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /incomplete/);
  assert.match(missing.stdout, new RegExp(SECRET_LINE));

  const empty = mkdtempSync(path.join(tmpdir(), "jev-empty-"));
  const emptyRun = run([empty]);
  assert.equal(emptyRun.status, 2);
  assert.match(emptyRun.stderr, /empty/);
  assert.doesNotMatch(emptyRun.stdout, /clean /);

  const host = mkdtempSync(path.join(tmpdir(), "jev-host-"));
  writeFileSync(path.join(host, "index.js"), "https://api.typesafe.ai/v1/systemone");
  const hostRun = run([host]);
  assert.equal(hostRun.status, 1);
  assert.match(hostRun.stderr, /api\.typesafe\.ai/);

  const crash = run(["--crash"]);
  assert.equal(crash.status, 3);
  assert.match(crash.stderr, /crash probe/);
  assert.match(crash.stdout, new RegExp(SECRET_LINE));
});

/** @param {string[]} args */
function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}
