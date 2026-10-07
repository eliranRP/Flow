import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./ci-apt-cache.sh", import.meta.url).pathname;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ci-apt-cache-"));
  const cache = join(dir, "cache");
  const archives = join(dir, "archives");
  mkdirSync(archives);
  const run = (mode) =>
    spawnSync("bash", [script, mode], {
      encoding: "utf8",
      env: { ...process.env, FLOW_APT_CACHE: cache, FLOW_APT_ARCHIVES: archives, FLOW_APT_SUDO: "" },
    });
  return { dir, cache, archives, run };
}

test("restore with an empty cache leaves the archive folder alone", () => {
  const { dir, archives, run } = setup();
  try {
    const result = run("restore");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /empty/);
    assert.deepEqual(readdirSync(archives), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save then restore carries the .deb files across runs", () => {
  const { dir, cache, archives, run } = setup();
  try {
    writeFileSync(join(archives, "fonts-a_1_all.deb"), "a");
    writeFileSync(join(archives, "lock"), "");
    let result = run("save");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /saved 1 packages/);
    assert.deepEqual(readdirSync(cache), ["fonts-a_1_all.deb"]);

    rmSync(archives, { recursive: true });
    mkdirSync(archives);
    result = run("restore");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /restored 1 packages/);
    assert.deepEqual(readdirSync(archives), ["fonts-a_1_all.deb"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown mode fails", () => {
  const { dir, run } = setup();
  try {
    assert.equal(run("purge").status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restore makes apt give up on a stalled mirror and retry", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(script, "utf8");
  assert.match(source, /Acquire::http::Timeout "30";/);
  assert.match(source, /Acquire::https::Timeout "30";/);
  assert.match(source, /Acquire::Retries "5";/);
});
