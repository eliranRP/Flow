import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./health-check.sh", import.meta.url);
const workflow = new URL("../.github/workflows/health.yml", import.meta.url);

function runCheck({ url = "postgresql://postgres@127.0.0.1:54322/postgres", report = "", fail = false }) {
  const dir = mkdtempSync(join(tmpdir(), "health-check-"));
  const log = join(dir, "args");
  writeFileSync(
    join(dir, "psql"),
    `#!/bin/bash
printf '%s\\n' "\$@" >> ${JSON.stringify(log)}
if [[ ${JSON.stringify(String(fail))} == true ]]; then exit 1; fi
printf '%s\\n' ${JSON.stringify(report)}
`,
  );
  chmodSync(join(dir, "psql"), 0o755);
  const result = spawnSync("bash", [script.pathname], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_DB_URL: url },
  });
  let args = "";
  try {
    args = readFileSync(log, "utf8");
  } catch {
    args = "";
  }
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, args };
}

test("each health check outcome has its own exit", () => {
  const missingUrl = spawnSync("bash", [script.pathname], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_DB_URL: "" },
  });
  assert.equal(missingUrl.status, 1);

  const failed = runCheck({ fail: true });
  assert.equal(failed.status, 1);
  assert.match(failed.args, /SET TRANSACTION READ ONLY/);
  assert.match(failed.args, /private\.health\(\)/);

  assert.equal(runCheck({ report: "not json" }).status, 1);
  assert.equal(runCheck({ report: JSON.stringify({ ok: "yes" }) }).status, 1);

  const ok = runCheck({ report: JSON.stringify({ ok: true, checked_at: "2026-10-08T06:00:00Z", alerts: [] }) });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /all checks passed/);

  const alert = runCheck({
    report: JSON.stringify({
      ok: false,
      checked_at: "2026-10-08T06:00:00Z",
      alerts: [{ check: "refresh_unclaimed", count: 2, detail: "refresh requests waiting more than 2 hours for the drain" }],
    }),
  });
  assert.equal(alert.status, 2);
  assert.match(alert.stdout, /refresh_unclaimed: 2/);
  assert.match(alert.stdout, /docs\/runbooks\/health-check\.md/);

  const warning = runCheck({
    report: JSON.stringify({
      ok: true,
      checked_at: "2026-10-08T06:00:00Z",
      alerts: [{ check: "jev_cap", count: 1, detail: "companies at 80% or more of their daily Jev call cap", level: "warning" }],
    }),
  });
  assert.equal(warning.status, 0);
  assert.match(warning.stdout, /warning jev_cap: 1/);
});

test("psql errors reach the log with the database URL masked", () => {
  const dir = mkdtempSync(join(tmpdir(), "health-check-"));
  writeFileSync(join(dir, "psql"), `#!/bin/bash
echo 'connection to postgresql://postgres.ref:secret@db.example.com:5432/postgres failed' >&2
exit 2
`);
  chmodSync(join(dir, "psql"), 0o755);
  const result = spawnSync("bash", [script.pathname], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_DB_URL: "postgresql://x" },
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes("secret"), false);
  assert.match(result.stderr, /postgresql:\/\/\*\*\*/);
});

test("the daily workflow runs the check read only with the existing secret", () => {
  const yml = readFileSync(workflow, "utf8");
  assert.match(yml, /schedule:/);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /bash scripts\/health-check\.sh/);
  assert.match(yml, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(yml, /permissions:\s*\n\s*contents: read/);
  assert.match(yml, /environment: production/);
  assert.match(yml, /persist-credentials: false/);
  assert.equal(/supabase (db push|migration)/.test(yml), false);
});
