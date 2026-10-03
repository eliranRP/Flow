import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./check-sumit-cron.sh", import.meta.url);
const sqlFiles = [
  new URL("../supabase/migrations/20260928140000_phase1_slice.sql", import.meta.url),
  new URL("../supabase/migrations/20261003140000_sumit_daily_schedule.sql", import.meta.url),
  new URL("../supabase/tests/database/sumit_daily_schedule.test.sql", import.meta.url),
  new URL("./check-sumit-cron.sql", import.meta.url),
];

function dollarCron(sql) {
  const marker = "$cron$";
  const start = sql.indexOf(marker);
  const end = sql.indexOf(marker, start + marker.length);
  assert.ok(start >= 0 && end > start);
  return sql.slice(start + marker.length, end);
}

test("the daily command matches the phase 1 insert", () => {
  const [original, ...copies] = sqlFiles.map((url) => readFileSync(url, "utf8"));
  const command = dollarCron(original);
  assert.match(command, /insert into public\.sumit_refresh_requests/);
  for (const copy of copies) assert.equal(dollarCron(copy), command);
  const check = readFileSync(new URL("./check-sumit-cron.sql", import.meta.url), "utf8");
  assert.match(check, /'0 3 \* \* \*'/);
  assert.match(check, /'\*\/5 \* \* \* \*'/);
  const shell = readFileSync(script, "utf8");
  assert.equal(/\bcron\.schedule\b/.test(shell), false);
  assert.equal(/\bcron\.unschedule\b/.test(shell), false);
  assert.match(shell, /SET TRANSACTION READ ONLY/);
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
