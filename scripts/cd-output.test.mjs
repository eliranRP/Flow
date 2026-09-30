import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyDryRun,
  dryRunHeadsUp,
  lastNonEmptyLine,
  localUpToDate,
  preflightCountNames,
  preflightCounts,
  readOnlySession,
  remoteUpToDate,
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
  }
  assert.equal(preflightCounts("SET0|1|2|3|4|5|6|7|8|9|10").ok, false);
  assert.equal(preflightCounts("0 1 2 3 4 5 6 7 8 9 10").ok, false);
  assert.equal(preflightCounts("0|1|2").ok, false);
});

test("dry-run text matches Supabase CLI 2.118.0 for up to date and pending", () => {
  const upToDate = [
    dryRunHeadsUp,
    "Connecting to remote database...",
    remoteUpToDate,
  ].join("\n");
  assert.deepEqual(classifyDryRun(upToDate), { ok: true, kind: "up-to-date", target: "remote" });
  const localUpToDateLog = [
    dryRunHeadsUp,
    "Connecting to local database...",
    localUpToDate,
  ].join("\n");
  assert.deepEqual(classifyDryRun(localUpToDateLog), { ok: true, kind: "up-to-date", target: "local" });

  const pending = [
    dryRunHeadsUp,
    "Connecting to remote database...",
    wouldPushMigrations,
    " • \u001b[1m20990101000000_ci_dry_run_pending.sql\u001b[22m",
    "",
    "Finished supabase db push.",
  ].join("\n");
  assert.deepEqual(classifyDryRun(pending), { ok: true, kind: "pending" });

  assert.equal(classifyDryRun("Local database is up to date.").ok, false);
  assert.equal(classifyDryRun("Schema migrations are up to date.").ok, false);
  assert.equal(classifyDryRun(dryRunHeadsUp).ok, false);
  assert.equal(classifyDryRun(`${upToDate}\n${wouldPushMigrations}`).ok, false);
  assert.equal(classifyDryRun(`${upToDate}\n${localUpToDate}`).ok, false);
});
