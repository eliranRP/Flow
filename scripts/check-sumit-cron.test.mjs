import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./check-sumit-cron.sh", import.meta.url);
const phase1 = new URL("../supabase/migrations/20260928140000_phase1_slice.sql", import.meta.url);
const dailySchedule = new URL("../supabase/migrations/20261003140000_sumit_daily_schedule.sql", import.meta.url);
const drainUrl = new URL("../supabase/migrations/20261003160000_sumit_drain_url.sql", import.meta.url);
const engine = new URL("../supabase/migrations/20261003210000_connector_engine.sql", import.meta.url);
const totals = new URL("../supabase/migrations/20261004130000_mercury_ils_totals.sql", import.meta.url);
const mercuryUrl = new URL("../supabase/migrations/20261013040000_mercury_sync_atomic.sql", import.meta.url);
const pgtap = new URL("../supabase/tests/database/sumit_daily_schedule.test.sql", import.meta.url);
const checkSql = new URL("./check-sumit-cron.sql", import.meta.url);

function dollarBlocks(sql, marker = "$cron$") {
  const blocks = [];
  let from = 0;
  while (from < sql.length) {
    const start = sql.indexOf(marker, from);
    if (start < 0) break;
    const end = sql.indexOf(marker, start + marker.length);
    assert.ok(end > start);
    blocks.push(sql.slice(start + marker.length, end));
    from = end + marker.length;
  }
  assert.ok(blocks.length > 0);
  return blocks;
}

function dollarCron(sql) {
  return dollarBlocks(sql)[0];
}

test("the phase 1 daily command stays the historical insert", () => {
  const original = readFileSync(phase1, "utf8");
  const copy = readFileSync(dailySchedule, "utf8");
  const command = dollarCron(original);
  assert.match(command, /insert into public\.sumit_refresh_requests/);
  assert.equal(dollarCron(copy), command);
  const shell = readFileSync(script, "utf8");
  assert.equal(/\bcron\.schedule\b/.test(shell), false);
  assert.equal(/\bcron\.unschedule\b/.test(shell), false);
  assert.match(shell, /SET TRANSACTION READ ONLY/);
  assert.match(shell, /cron_secret decides whether flow-connector-drain should exist/);
  assert.match(shell, /flow_sync_url is the drain URL/);
});

test("the connector daily and drain commands match across the migration, pgTAP, and check", () => {
  const migration = readFileSync(engine, "utf8");
  const tap = readFileSync(pgtap, "utf8");
  const check = readFileSync(checkSql, "utf8");
  const daily = dollarBlocks(migration)[0];
  // FLOW-509 patches the Mercury URL line in place: anchor ($a$) to replacement ($n$), second pair.
  const patch = readFileSync(mercuryUrl, "utf8");
  const anchor = dollarBlocks(patch, "$a$")[1];
  const replacement = dollarBlocks(patch, "$n$")[1];
  const original = dollarBlocks(readFileSync(totals, "utf8"))[1];
  assert.equal(original.split(anchor).length, 2);
  const drain = original.replace(anchor, replacement);
  assert.match(daily, /insert into public\.connector_refresh_requests/);
  assert.equal(dollarCron(tap), daily);
  assert.equal(dollarBlocks(check)[0], daily);
  assert.equal(dollarBlocks(check)[1], drain);
  assert.match(check, /'0 3 \* \* \*'/);
  assert.match(check, /'\*\/5 \* \* \* \*'/);
  assert.match(check, /flow-connector-daily/);
  assert.match(check, /flow-connector-drain/);
  assert.match(drain, /where name = 'flow_sync_url'/);
  assert.match(drain, /where name = 'cron_secret'/);
  assert.match(drain, /where m\.name = 'flow_mercury_sync_url'/);
  assert.match(drain, /last_error is distinct from 'auth'/);
  assert.equal(drain.includes("http://kong:8000"), false);
  assert.equal(/x-flow-cron',\s*'/.test(drain), false);
  assert.match(check, /not has_url/);
});

test("the historical drain command is unchanged and has no Kong fallback", () => {
  const command = dollarBlocks(readFileSync(drainUrl, "utf8"))[0];
  assert.match(command, /from public\.sumit_refresh_requests r/);
  assert.match(command, /last_error is distinct from 'sumit_auth'/);
  assert.match(command, /where name = 'flow_sync_url'/);
  assert.match(command, /where name = 'cron_secret'/);
  assert.equal(command.includes("http://kong:8000"), false);
  assert.equal(/x-flow-cron',\s*'/.test(command), false);
});

function runCheck({ url = "postgresql://postgres@127.0.0.1:54322/postgres", cron = "t", status = "ok", fail = "" }) {
  const dir = mkdtempSync(join(tmpdir(), "sumit-cron-"));
  const log = join(dir, "args");
  writeFileSync(
    join(dir, "psql"),
    `#!/bin/bash
printf '%s\\n' "\$@" >> ${JSON.stringify(log)}
if [[ "\$*" == *to_regclass* ]]; then
  if [[ ${JSON.stringify(fail)} == first ]]; then exit 1; fi
  printf '%s\\n' ${JSON.stringify(cron)}
  exit 0
fi
if [[ "\$*" == *check-sumit-cron.sql ]]; then
  if [[ ${JSON.stringify(fail)} == second ]]; then exit 1; fi
  printf '%s\\n' ${JSON.stringify(status)}
  exit 0
fi
echo "unexpected psql call" >&2
exit 1
`,
  );
  chmodSync(join(dir, "psql"), 0o755);
  const result = spawnSync("bash", [script.pathname], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_DB_URL: url },
  });
  const args = readFileSync(log, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, args };
}

test("each cron check outcome has its own exit", () => {
  const missingUrl = spawnSync("bash", [script.pathname], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_DB_URL: "" },
  });
  assert.equal(missingUrl.status, 1);

  const probeFailed = runCheck({ fail: "first" });
  assert.equal(probeFailed.status, 1);
  assert.match(probeFailed.args, /SET TRANSACTION READ ONLY/);

  const noCron = runCheck({ cron: "f" });
  assert.equal(noCron.status, 4);
  assert.equal(noCron.args.includes("check-sumit-cron.sql"), false);

  const unread = runCheck({ cron: "maybe" });
  assert.equal(unread.status, 1);

  const queryFailed = runCheck({ fail: "second" });
  assert.equal(queryFailed.status, 1);
  assert.match(queryFailed.args, /check-sumit-cron.sql/);

  const ok = runCheck({ status: "ok" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /SUMIT cron jobs match/);

  const daily = runCheck({ status: "bad-daily" });
  assert.equal(daily.status, 2);

  const drain = runCheck({ status: "bad-drain" });
  assert.equal(drain.status, 3);

  const unknown = runCheck({ status: "pending" });
  assert.equal(unknown.status, 1);
});
