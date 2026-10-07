import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

test("restore makes apt give up on a stalled mirror and retry", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /Acquire::http::Timeout "30";/);
  assert.match(source, /Acquire::https::Timeout "30";/);
  assert.match(source, /Acquire::Retries "5";/);
});

/**
 * Runs `install` with a fake playwright and apt-get. The fake dry run reports the packages in
 * `missing` until the fake apt-get installs them, and apt-get fails when `aptFails` is set.
 * @param {{ missing: string, aptFails?: boolean }} options
 */
function install({ missing, aptFails = false }) {
  const dir = mkdtempSync(join(tmpdir(), "ci-apt-install-"));
  const log = join(dir, "log");
  const state = join(dir, "missing");
  writeFileSync(state, missing);
  writeFileSync(log, "");
  const playwright = join(dir, "playwright");
  writeFileSync(
    playwright,
    `#!/usr/bin/env bash
echo "playwright $*" >> "${log}"
[[ "$*" == *--dry-run* ]] || exit 0
if [[ -s "${state}" ]]; then
  echo "Missing system dependencies (1):"
  sed 's/^/  /' "${state}"
  exit 1
fi
echo "All system dependencies are installed."
`,
  );
  const aptGet = join(dir, "apt-get");
  writeFileSync(aptGet, `#!/usr/bin/env bash\necho "apt-get $*" >> "${log}"\n${aptFails ? "exit 100" : `: > "${state}"`}\n`);
  chmodSync(playwright, 0o755);
  chmodSync(aptGet, 0o755);
  const result = spawnSync("bash", [script, "install"], {
    encoding: "utf8",
    env: { ...process.env, FLOW_PLAYWRIGHT: playwright, FLOW_APT_GET: aptGet, FLOW_APT_SUDO: "" },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  rmSync(dir, { recursive: true, force: true });
  return { result, calls };
}

test("install does nothing when every package is already there", () => {
  const { result, calls } = install({ missing: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, ["playwright install-deps --dry-run chromium"]);
});

test("install takes the missing packages from the cache, with no apt-get update", () => {
  const { result, calls } = install({ missing: "fonts-liberation" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    "playwright install-deps --dry-run chromium",
    "apt-get install -y --no-install-recommends --no-download fonts-liberation",
    "playwright install-deps --dry-run chromium",
  ]);
  assert.match(result.stdout, /from the cache/);
});

test("install falls back to install-deps when the cache does not cover a package", () => {
  const { result, calls } = install({ missing: "fonts-liberation", aptFails: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.at(-1), "playwright install-deps chromium");
});
