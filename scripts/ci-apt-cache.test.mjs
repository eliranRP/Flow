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
 * Runs a mode with a fake playwright and apt-get. The fake dry run reports the packages in
 * `missing` until the fake apt-get installs them. `failing` lists apt-get argument patterns that fail.
 * `stalling` lists patterns that hang for 5 seconds instead.
 * @param {{ mode?: string, missing: string, failing?: RegExp[], stalling?: RegExp[], env?: Record<string, string> }} options
 */
function runFake({ mode = "install", missing, failing = [], stalling = [], env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "ci-apt-install-"));
  const log = join(dir, "log");
  const state = join(dir, "missing");
  const sources = join(dir, "ubuntu.sources");
  writeFileSync(state, missing);
  writeFileSync(log, "");
  writeFileSync(sources, "URIs: http://azure.archive.ubuntu.com/ubuntu/\n");
  // Ubuntu 26.04 runners: ubuntu.sources says `mirror+file:` and this list holds the real mirror.
  const mirrors = join(dir, "apt-mirrors.txt");
  writeFileSync(mirrors, "http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://archive.ubuntu.com/ubuntu/\tpriority:2\n");
  const confDir = join(dir, "apt.conf.d");
  mkdirSync(confDir);
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
  const fails = [
    ...failing.map((pattern) => `[[ "$*" =~ ${pattern.source} ]] && exit 100`),
    ...stalling.map((pattern) => `[[ "$*" =~ ${pattern.source} ]] && sleep 5`),
  ].join("\n");
  const aptGet = join(dir, "apt-get");
  writeFileSync(
    aptGet,
    `#!/usr/bin/env bash\necho "apt-get $*" >> "${log}"\n${fails}\n[[ "$1" == install ]] && : > "${state}"\nexit 0\n`,
  );
  chmodSync(playwright, 0o755);
  chmodSync(aptGet, 0o755);
  const result = spawnSync("bash", [script, mode], {
    encoding: "utf8",
    env: {
      ...process.env,
      FLOW_PLAYWRIGHT: playwright,
      FLOW_APT_GET: aptGet,
      FLOW_APT_SUDO: "",
      FLOW_APT_SOURCES: sources,
      FLOW_APT_MIRRORS: mirrors,
      FLOW_APT_CONF_DIR: confDir,
      ...env,
    },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  const mirror = readFileSync(sources, "utf8");
  const mirrorList = readFileSync(mirrors, "utf8");
  const conf = readdirSync(confDir).map((name) => readFileSync(join(confDir, name), "utf8")).join("");
  rmSync(dir, { recursive: true, force: true });
  return { result, calls, mirror, mirrorList, conf };
}

test("install does nothing when every package is already there", () => {
  const { result, calls } = runFake({ missing: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, ["playwright install-deps --dry-run chromium"]);
});

test("install takes the missing packages from the cache, with no apt-get update", () => {
  const { result, calls, mirror } = runFake({ missing: "fonts-liberation" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    "playwright install-deps --dry-run chromium",
    "apt-get install -y --no-install-recommends --no-download fonts-liberation",
    "playwright install-deps --dry-run chromium",
  ]);
  assert.match(result.stdout, /from the cache/);
  assert.match(mirror, /azure\.archive/);
});

test("install downloads what the cache does not cover", () => {
  const { result, calls, mirror } = runFake({ missing: "fonts-liberation", failing: [/--no-download/] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls.slice(2), [
    "apt-get update",
    "playwright install-deps --dry-run chromium",
    "apt-get install -y --no-install-recommends fonts-liberation",
    "playwright install-deps --dry-run chromium",
  ]);
  assert.match(mirror, /azure\.archive/);
});

test("a failed apt-get update switches to archive.ubuntu.com and tries twice more", () => {
  const { result, calls, mirror, mirrorList } = runFake({ missing: "fonts-liberation", failing: [/--no-download/, /^update$/] });
  assert.notEqual(result.status, 0);
  assert.deepEqual(calls.slice(2), ["apt-get update", "apt-get update", "apt-get update"]);
  assert.match(result.stdout, /switching to archive\.ubuntu\.com/);
  assert.match(result.stdout, /one more try/);
  assert.equal(mirror, "URIs: http://archive.ubuntu.com/ubuntu/\n");
  // The mirror list of the runner image is rewritten too: that is where a 26.04 runner reads its mirror.
  assert.equal(mirrorList, "http://archive.ubuntu.com/ubuntu/\tpriority:1\n");
});

test("the fallback matches a mirror host with digits and hyphens", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-apt-sed-"));
  try {
    const sources = join(dir, "ubuntu.sources");
    writeFileSync(sources, "URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\nURIs: http://security.ubuntu.com/ubuntu/\n");
    const run = spawnSync("bash", [script, "psql"], {
      encoding: "utf8",
      env: {
        ...process.env,
        FLOW_APT_SUDO: "",
        FLOW_APT_SOURCES: sources,
        FLOW_APT_MIRRORS: join(dir, "none"),
        FLOW_APT_CONF_DIR: "",
        FLOW_PSQL: "no-such-psql",
        FLOW_APT_GET: "false",
        FLOW_APT_TIMEOUT: "1",
        FLOW_APT_RETRY_TIMEOUT: "1",
      },
    });
    assert.notEqual(run.status, 0);
    assert.equal(readFileSync(sources, "utf8"), "URIs: http://archive.ubuntu.com/ubuntu/\nURIs: http://security.ubuntu.com/ubuntu/\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install and psql write the apt timeout and retry settings, not only restore", () => {
  for (const mode of ["install", "psql"]) {
    const { result, conf } = runFake({ mode, missing: "", env: { FLOW_PSQL: "bash" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(conf, /Acquire::http::Timeout "30";/);
    assert.match(conf, /Acquire::Retries "5";/);
  }
});

test("a stalled apt-get is cut off by the time limit", () => {
  const { result, calls } = runFake({
    missing: "fonts-liberation",
    failing: [/--no-download/],
    stalling: [/^update$/],
    env: { FLOW_APT_TIMEOUT: "1", FLOW_APT_RETRY_TIMEOUT: "1" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /switching to archive\.ubuntu\.com/);
  assert.deepEqual(calls.slice(2), ["apt-get update", "apt-get update", "apt-get update"]);
});

test("psql is left alone when the runner has it, and installed when it does not", () => {
  let { result, calls } = runFake({ mode: "psql", missing: "", env: { FLOW_PSQL: "bash" } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, []);
  ({ result, calls } = runFake({ mode: "psql", missing: "", env: { FLOW_PSQL: "no-such-psql" } }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, ["apt-get update", "apt-get install -y --no-install-recommends postgresql-client"]);
});
