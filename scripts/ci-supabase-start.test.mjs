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
 * @param {Record<string, string>} [env] more settings for the script
 * @param {Record<string, string>} [extraBin] more fake commands, by name
 */
function setup(modes, env = {}, extraBin = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ci-supabase-start-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "supabase"), supabaseShim);
  writeFileSync(join(bin, "docker"), dockerShim);
  chmodSync(join(bin, "supabase"), 0o755);
  chmodSync(join(bin, "docker"), 0o755);
  for (const [name, body] of Object.entries(extraBin)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
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
      FLOW_SUPABASE_START_ATTEMPTS: "2",
      FLOW_BOUNDED_GRACE: "1",
      ...env,
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

test("a third attempt runs when the budget has room and the first two fail", () => {
  const { dir, result, calls } = setup("fail,fail,ok", { FLOW_SUPABASE_START_ATTEMPTS: "3" });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, ["start -x a,b", "stop --no-backup", "start -x a,b", "stop --no-backup", "start -x a,b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no attempt starts that the budget cannot finish", () => {
  const { dir, result, calls, elapsed } = setup("hang,ok", {
    FLOW_SUPABASE_START_TIMEOUT: "2",
    FLOW_SUPABASE_STOP_TIMEOUT: "1",
    FLOW_SUPABASE_START_BUDGET: "9",
  });
  try {
    assert.equal(result.status, 1);
    assert.deepEqual(calls, ["start -x a,b"]);
    assert.match(result.stdout, /gave up after/);
    assert.ok(elapsed < 20_000, `took ${elapsed} ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a start the kernel will not release is abandoned, and docker ps that hangs does not hold the job", () => {
  // The fake timeout never returns, the way it waits on a process stuck in the kernel.
  const stuck = "#!/usr/bin/env bash\nsleep 60\n";
  const { dir, result, elapsed } = setup("hang,hang", { FLOW_SUPABASE_START_ATTEMPTS: "1", FLOW_BOUNDED_KILL: "1", FLOW_SUPABASE_DIAG_TIMEOUT: "1" }, { timeout: stuck, docker: stuck });
  try {
    assert.equal(result.status, 1);
    assert.match(result.stdout, /attempt 1 timed out/);
    assert.match(result.stdout, /gave up after/);
    // Each call is given up on after its limit 1 + kill 1 + grace 1 = 3 s: the start and four diagnostics.
    assert.ok(elapsed < 30_000, `took ${elapsed} ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the failure log names the machine's state", () => {
  const { dir, result } = setup("fail,fail");
  try {
    assert.equal(result.status, 1);
    assert.match(result.stdout, /docker ps -a:/);
    assert.match(result.stdout, /disk and memory:/);
    assert.match(result.stdout, /supabase and docker processes:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the wait script reports a stalled start with its log and fails before the step limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-supabase-wait-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), dockerShim);
    chmodSync(join(bin, "docker"), 0o755);
    writeFileSync(join(dir, "supabase-start.log"), "ci-supabase-start: attempt 1, limit 120s\nPulling\n");
    const wait = new URL("./ci-supabase-wait.sh", import.meta.url).pathname;
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir, FLOW_SUPABASE_WAIT: "2" };
    let result = spawnSync("bash", [wait], { encoding: "utf8", env });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /did not finish within 2s/);
    assert.match(result.stdout, /attempt 1, limit 120s/);
    assert.match(result.stdout, /CONTAINER fake-db Up/);
    writeFileSync(join(dir, "supabase-start.exit"), "1");
    result = spawnSync("bash", [wait], { encoding: "utf8", env });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /attempt 1, limit 120s/);
    writeFileSync(join(dir, "supabase-start.exit"), "0");
    result = spawnSync("bash", [wait], { encoding: "utf8", env });
    assert.equal(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workflows call the script and every wait step has its own limit", () => {
  for (const text of [ci, pr]) assert.doesNotMatch(text, /supabase start/);
  assert.equal(ci.match(/scripts\/ci-supabase-start\.sh/g).length, 1);
  assert.equal(pr.match(/scripts\/ci-supabase-start\.sh/g).length, 2);
  // The wait script gives up after 420 s and prints what the start was doing; the step limit is the backstop.
  assert.match(ci, /Wait for local Supabase\n {8}timeout-minutes: 8\n {8}run: bash scripts\/ci-supabase-wait\.sh\n/);
  assert.match(pr, /Wait for local Supabase\n {8}timeout-minutes: 8\n {8}run: bash scripts\/ci-supabase-wait\.sh\n/);
  assert.match(readFileSync(new URL("./ci-supabase-wait.sh", import.meta.url), "utf8"), /FLOW_SUPABASE_WAIT:-420/);
  assert.match(
    pr,
    /Start local Supabase \(database[^\n]*\n {8}timeout-minutes: 8\n {8}run: bash scripts\/ci-supabase-start\.sh -x [^\n]*storage-api\n/,
  );
  const source = readFileSync(script, "utf8");
  assert.match(source, /FLOW_SUPABASE_START_TIMEOUT:-120/);
  assert.match(source, /FLOW_SUPABASE_START_ATTEMPTS:-3/);
  assert.match(source, /FLOW_SUPABASE_START_BUDGET:-330/);
  assert.match(source, /supabase stop --no-backup/);
  assert.match(source, /docker ps -a/);
});
