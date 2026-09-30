import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
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

test("dry-run text matches whole lines for the expected target", () => {
  const upToDate = [
    dryRunHeadsUp,
    "Connecting to remote database...",
    remoteUpToDate,
  ].join("\n");
  assert.deepEqual(classifyDryRun(upToDate, "remote"), { ok: true, kind: "up-to-date", target: "remote" });
  const localUpToDateLog = [
    dryRunHeadsUp,
    "Connecting to local database...",
    localUpToDate,
  ].join("\n");
  assert.deepEqual(classifyDryRun(localUpToDateLog, "local"), { ok: true, kind: "up-to-date", target: "local" });

  const pending = [
    dryRunHeadsUp,
    "Connecting to remote database...",
    wouldPushMigrations,
    " • \u001b[1m20990101000000_ci_dry_run_pending.sql\u001b[22m",
    "",
    "Finished supabase db push.",
  ].join("\n");
  assert.deepEqual(classifyDryRun(pending, "remote"), {
    ok: true,
    kind: "pending",
    migrations: ["20990101000000_ci_dry_run_pending.sql"],
  });
  const localPending = pending.replace("remote database", "local database");
  assert.equal(classifyDryRun(localPending, "local").ok, false);
  assert.deepEqual(classifyDryRun(localPending, "local", "pending"), {
    ok: true,
    kind: "pending",
    migrations: ["20990101000000_ci_dry_run_pending.sql"],
  });

  assert.equal(classifyDryRun(localUpToDateLog, "remote").ok, false);
  assert.match(classifyDryRun(localUpToDateLog, "remote").reason ?? "", /Local/);
  assert.equal(classifyDryRun(`${upToDate}\n • 20990101000000_ci_dry_run_pending.sql`, "remote").ok, false);
  assert.equal(classifyDryRun(`${dryRunHeadsUp}\nRemote database is up to date. extra`, "remote").ok, false);
  assert.equal(classifyDryRun(`${dryRunHeadsUp}\nnote ${remoteUpToDate}`, "remote").ok, false);
  assert.equal(classifyDryRun("Local database is up to date.", "local").ok, false);
  assert.equal(classifyDryRun("Schema migrations are up to date.", "remote").ok, false);
  assert.equal(classifyDryRun(dryRunHeadsUp, "remote").ok, false);
  assert.equal(classifyDryRun(`${upToDate}\n${wouldPushMigrations}`, "remote").ok, false);
  assert.equal(classifyDryRun(`${upToDate}\n${localUpToDate}`, "remote").ok, false);
  assert.equal(classifyDryRun(upToDate, "hosted").ok, false);
  assert.equal(classifyDryRun(upToDate).ok, false);
});

test("dry-run JSON from CLI 2.118.0 wins over the plain-text lines", () => {
  const remoteJson = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Remote database is up to date."}';
  const hosted = [dryRunHeadsUp, "Connecting to remote database...", remoteJson].join("\n");
  assert.deepEqual(classifyDryRun(hosted, "remote"), { ok: true, kind: "up-to-date", target: "remote" });
  assert.deepEqual(classifyDryRun(remoteJson, "remote"), { ok: true, kind: "up-to-date", target: "remote" });
  assert.equal(classifyDryRun(remoteJson, "local").ok, false);

  const localJson = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Local database is up to date."}';
  assert.deepEqual(classifyDryRun(localJson, "local"), { ok: true, kind: "up-to-date", target: "local" });
  assert.equal(classifyDryRun(localJson, "remote").ok, false);

  const pendingJson = '{"upToDate":false,"dryRun":true,"migrations":["20990101000000_ci_dry_run_pending.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}';
  assert.deepEqual(classifyDryRun(pendingJson, "remote"), {
    ok: true,
    kind: "pending",
    migrations: ["20990101000000_ci_dry_run_pending.sql"],
  });
  assert.equal(classifyDryRun(pendingJson, "local").ok, false);
  assert.deepEqual(classifyDryRun(pendingJson, "local", "pending"), {
    ok: true,
    kind: "pending",
    migrations: ["20990101000000_ci_dry_run_pending.sql"],
  });
  assert.deepEqual(classifyDryRun(`${pendingJson}\n${remoteUpToDate}`, "remote"), {
    ok: true,
    kind: "pending",
    migrations: ["20990101000000_ci_dry_run_pending.sql"],
  });

  const listed = '{"upToDate":true,"dryRun":true,"migrations":["20990101000000_ci_dry_run_pending.sql"],"seeds":[],"roles":[],"message":"Remote database is up to date."}';
  assert.equal(classifyDryRun(listed, "remote").ok, false);
  const seeded = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":["seed.sql"],"roles":[],"message":"Remote database is up to date."}';
  assert.equal(classifyDryRun(seeded, "remote").ok, false);
  const otherMessage = '{"upToDate":true,"dryRun":true,"migrations":[],"seeds":[],"roles":[],"message":"Finished supabase db push."}';
  assert.equal(classifyDryRun(otherMessage, "remote").ok, false);
});
