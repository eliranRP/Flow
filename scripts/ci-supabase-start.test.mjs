import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./ci-supabase-start.sh", import.meta.url).pathname;
const workflows = ["ci", "pr"].map((name) => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
const [ci, pr] = workflows;

const supabaseShim = `#!/usr/bin/env bash
echo "$*" >> "$SHIM_CALLS"
if [ "$1" = stop ]; then exit 0; fi
n=$(grep -c '^start' "$SHIM_CALLS")
IFS=, read -ra m <<<"$SHIM_MODES"
mode=\${m[$((n-1))]}
case "$mode" in
  ok) echo started; exit 0 ;;
  fail) echo boom; exit 3 ;;
  hang) exec sleep 30 ;;
esac
`;

const dockerShim = `#!/usr/bin/env bash
echo "CONTAINER fake-db Up"
`;

/**
 * Runs the script with fake `supabase` and `docker` commands. `modes` gives the outcome of each
 * `supabase start` in turn: ok, fail (exit 3) or hang (sleeps past the limit).
 * @param {string} modes
 */
function setup(modes) {
  const dir = mkdtempSync(join(tmpdir(), "ci-supabase-start-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "supabase"), supabaseShim);
  writeFileSync(join(bin, "docker"), dockerShim);
  chmodSync(join(bin, "supabase"), 0o755);
  chmodSync(join(bin, "docker"), 0o755);
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  const started = Date.now();
  const result = spawnSync("bash", [script, "-x", "a,b"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SHIM_CALLS: calls,
      SHIM_MODES: modes,
      FLOW_SUPABASE_START_LOG: join(dir, "start.log"),
      FLOW_SUPABASE_START_TIMEOUT: "1",
      FLOW_SUPABASE_STOP_TIMEOUT: "5",
    },
  });
  const calledWith = readFileSync(calls, "utf8").trim().split("\n");
  return { dir, result, calls: calledWith, elapsed: Date.now() - started };
}

test("a start that succeeds runs once", () => {
  const { dir, result, calls } = setup("ok");
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, ["start -x a,b"]);
    assert.match(result.stdout, /started/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hung start is cut off, stopped with --no-backup, and retried once", () => {
  const { dir, result, calls, elapsed } = setup("hang,ok");
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, ["start -x a,b", "stop --no-backup", "start -x a,b"]);
    assert.match(readFileSync(join(dir, "start.log"), "utf8"), /attempt 1 timed out/);
    assert.ok(elapsed < 20_000, `took ${elapsed} ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two hung starts fail and print docker ps -a and the log", () => {
  const { dir, result, calls } = setup("hang,hang");
  try {
    assert.equal(result.status, 1);
    assert.match(result.stdout, /CONTAINER fake-db Up/);
    assert.match(result.stdout, /attempt 2 timed out/);
    assert.equal(calls.filter((call) => call.startsWith("start")).length, 2);
    assert.equal(calls.filter((call) => call.startsWith("stop")).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a start that exits non-zero is retried and its output is kept", () => {
  const { dir, result } = setup("fail,fail");
  try {
    assert.equal(result.status, 1);
    assert.equal(result.stdout.match(/boom/g).length, 2);
    assert.match(result.stdout, /exited with 3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflows call the script and every wait step has its own limit", () => {
  for (const text of [ci, pr]) assert.doesNotMatch(text, /supabase start/);
  assert.equal(ci.match(/scripts\/ci-supabase-start\.sh/g).length, 1);
  assert.equal(pr.match(/scripts\/ci-supabase-start\.sh/g).length, 2);
  assert.match(ci, /Wait for local Supabase\n {8}timeout-minutes: 8\n/);
  assert.match(pr, /Wait for local Supabase\n {8}timeout-minutes: 8\n/);
  assert.match(
    pr,
    /Start local Supabase \(database[^\n]*\n {8}timeout-minutes: 8\n {8}run: bash scripts\/ci-supabase-start\.sh -x [^\n]*storage-api\n/,
  );
  const source = readFileSync(script, "utf8");
  assert.match(source, /FLOW_SUPABASE_START_TIMEOUT:-180/);
  assert.match(source, /supabase stop --no-backup/);
  assert.match(source, /docker ps -a/);
});
