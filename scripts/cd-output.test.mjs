import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import {
  acceptPreflightKind,
  backfillVersions,
  backfillVersionsRecorded,
  classifyDryRun,
  dryRunHeadsUp,
  lastNonEmptyLine,
  localUpToDate,
  preflightCountNames,
  preflightCounts,
  readOnlySession,
  remoteUpToDate,
  ruleRiskIsZero,
  wouldPushMigrations,
} from "./cd-output.mjs";

test("a psql command tag on its own line is not glued onto the value", () => {
  const captured = "SET\non\n";
  assert.equal(lastNonEmptyLine(captured), "on");
  assert.deepEqual(readOnlySession(captured), { ok: true });
  assert.equal(readOnlySession("SETon").ok, false);
  assert.equal(readOnlySession("SET\noff\n").ok, false);
});

test("preflight counts are the eleven integers on the last line, in SQL order", () => {
  const sql = readFileSync(new URL("./preflight-r23.sql", import.meta.url), "utf8");
  const aliases = [...sql.matchAll(/\) as ([a-z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual(aliases, preflightCountNames);

  const row = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("|");
  const parsed = preflightCounts(`SET\n${row}\n`);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.counts.backfill_240000_transactions, 0);
    assert.equal(parsed.counts.backfill_260000_review_priors, 10);
    assert.equal(Object.keys(parsed.counts).length, 11);
    assert.equal(ruleRiskIsZero(parsed.counts), false);
  }
  const clear = preflightCounts("0|0|0|0|0|0|0|0|0|0|0");
  assert.equal(clear.ok, true);
  if (clear.ok) assert.equal(ruleRiskIsZero(clear.counts), true);
  assert.equal(preflightCounts("SET0|1|2|3|4|5|6|7|8|9|10").ok, false);
  assert.equal(preflightCounts("0 1 2 3 4 5 6 7 8 9 10").ok, false);
  assert.equal(preflightCounts("0|1|2").ok, false);
});

test("recorded backfill versions are the three whole lines, and a risk count blocks", () => {
  assert.equal(backfillVersionsRecorded(`${backfillVersions.join("\n")}\n`), true);
  assert.equal(backfillVersionsRecorded(backfillVersions[0]), false);
  assert.equal(backfillVersionsRecorded(`${backfillVersions.join("\n")}\nextra`), false);
  assert.equal(backfillVersionsRecorded(`note ${backfillVersions[0]}`), false);
});

const remoteJson = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Remote database is up to date."}';
const localJson = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Local database is up to date."}';
const pendingName = "20990101000000_ci_dry_run_pending.sql";
const pendingJson = `{"upToDate":false,"dryRun":true,"migrations":["${pendingName}"],"seeds":[],"roles":[],"message":"Finished supabase db push."}`;

/** @param {string} json @param {string[]} [extra] */
function jsonLog(json, extra = []) {
  return [dryRunHeadsUp, "Connecting to remote database...", ...extra, json].join("\n");
}

test("remote JSON up to date requires the DRY RUN line and an empty result", () => {
  assert.deepEqual(classifyDryRun(jsonLog(remoteJson), "remote"), { ok: true, kind: "up-to-date", target: "remote" });
});

test("local JSON up to date accepts only a Local message", () => {
  assert.deepEqual(classifyDryRun(jsonLog(localJson), "local"), { ok: true, kind: "up-to-date", target: "local" });
});

test("pending JSON reports the migration names when they match the text list", () => {
  const log = jsonLog(pendingJson, [wouldPushMigrations, ` • \u001b[1m${pendingName}\u001b[22m`]);
  assert.deepEqual(classifyDryRun(log, "remote"), { ok: true, kind: "pending", migrations: [pendingName] });
});

test("local pending JSON is accepted only when pending is expected", () => {
  const log = jsonLog(pendingJson, [wouldPushMigrations, `• ${pendingName}`]);
  assert.deepEqual(classifyDryRun(log, "local", "pending"), { ok: true, kind: "pending", migrations: [pendingName] });
});

test("plain text without a JSON result fails", () => {
  const textOnly = [dryRunHeadsUp, "Connecting to remote database...", remoteUpToDate].join("\n");
  const result = classifyDryRun(textOnly, "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /exactly one JSON result/);
});

test("malformed JSON fails", () => {
  const result = classifyDryRun(jsonLog("{not json"), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /malformed JSON/);
});

test("JSON whose dryRun is not true fails", () => {
  const result = classifyDryRun(jsonLog('{"dryRun":false,"upToDate":true,"migrations":[],"seeds":[],"roles":[],"message":"Remote database is up to date."}'), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /dryRun to true/);
});

test("two JSON results fail", () => {
  const result = classifyDryRun(`${jsonLog(remoteJson)}\n${remoteJson}`, "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /exactly one JSON result/);
});

test("a JSON result without the DRY RUN line fails", () => {
  const result = classifyDryRun(remoteJson, "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /DRY RUN line/);
});

test("an up-to-date JSON result fails when the text would push migrations", () => {
  const result = classifyDryRun(jsonLog(remoteJson, [wouldPushMigrations]), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /pending migrations alongside an up-to-date result/);
});

test("an up-to-date JSON result fails when the text lists a sql file", () => {
  const result = classifyDryRun(jsonLog(remoteJson, [`• ${pendingName}`]), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /migration file alongside an up-to-date result/);
});

test("pending JSON fails alongside an up-to-date text line", () => {
  const result = classifyDryRun(jsonLog(pendingJson, [wouldPushMigrations, `• ${pendingName}`, remoteUpToDate]), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /alongside an up-to-date line/);
});

test("JSON migration names must equal the text list", () => {
  const result = classifyDryRun(jsonLog(pendingJson, [wouldPushMigrations, "• other.sql"]), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /did not match the text list/);
});

test("local mode rejects pending JSON unless pending is expected", () => {
  const result = classifyDryRun(jsonLog(pendingJson, [`• ${pendingName}`]), "local");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /local target/);
});

test("prod mode rejects an up-to-date JSON message that does not start with Remote", () => {
  const result = classifyDryRun(jsonLog(localJson), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /start with Remote/);
});

test("local mode rejects an up-to-date JSON message that does not start with Local", () => {
  const result = classifyDryRun(jsonLog(remoteJson), "local");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /start with Local/);
});

test("up-to-date JSON that also lists migrations fails", () => {
  const listed = `{"upToDate":true,"dryRun":true,"migrations":["${pendingName}"],"seeds":[],"roles":[],"message":"Remote database is up to date."}`;
  const result = classifyDryRun(jsonLog(listed), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /also listed migrations, seeds, or roles/);
});

test("up-to-date JSON that also lists seeds fails", () => {
  const seeded = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":["seed.sql"],"roles":[],"message":"Remote database is up to date."}';
  const result = classifyDryRun(jsonLog(seeded), "remote");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /also listed migrations, seeds, or roles/);
});

test("a missing or unknown dry-run target fails", () => {
  assert.equal(classifyDryRun(jsonLog(remoteJson), "hosted").ok, false);
  assert.equal(classifyDryRun(jsonLog(remoteJson)).ok, false);
});

test("pending is not accepted from an up-to-date JSON result", () => {
  const result = classifyDryRun(jsonLog(remoteJson), "remote", "pending");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /pending was required/);
});

test("preflight kind matches the target, and an empty or crossed kind fails", () => {
  assert.deepEqual(acceptPreflightKind("up-to-date local", "local"), { ok: true });
  assert.deepEqual(acceptPreflightKind("up-to-date remote", "remote"), { ok: true });
  assert.deepEqual(acceptPreflightKind("pending", "remote"), { ok: true });
  assert.equal(acceptPreflightKind("pending", "local").ok, false);
  assert.equal(acceptPreflightKind("", "local").ok, false);
  assert.equal(acceptPreflightKind("up-to-date remote", "local").ok, false);
  assert.equal(acceptPreflightKind("up-to-date local", "remote").ok, false);
  assert.equal(acceptPreflightKind("up-to-date remote", "").ok, false);
  assert.equal(acceptPreflightKind("up-to-date remote", "hosted").ok, false);
});

test("preflight-kind CLI fails on an empty kind and passes a local up-to-date kind", () => {
  const script = new URL("./cd-output.mjs", import.meta.url).pathname;
  const empty = spawnSync(process.execPath, [script, "preflight-kind", "--target", "remote", ""], { encoding: "utf8" });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /did not match the target/);
  const ok = spawnSync(process.execPath, [script, "preflight-kind", "--target", "local", "up-to-date local"], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  const matched = spawnSync(process.execPath, [script, "equals", "hello"], { input: "noise\nhello\n", encoding: "utf8" });
  assert.equal(matched.status, 0);
  const missed = spawnSync(process.execPath, [script, "equals", "hello"], { input: "other\n", encoding: "utf8" });
  assert.equal(missed.status, 1);
});

test("preflight-kind does not read stdin", async () => {
  const script = new URL("./cd-output.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [script, "preflight-kind", "--target", "local", "up-to-date local"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("preflight-kind waited for stdin"));
      // Generous: a child that reads stdin waits forever on the open pipe, so any bound catches it,
      // and a short one failed under gate load just from process start-up.
    }, 15_000);
    child.on("exit", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  child.stdin.destroy();
  assert.equal(code, 0);
});
