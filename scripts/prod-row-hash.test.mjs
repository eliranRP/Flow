import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./prod-row-hash.sh", import.meta.url);
const query = new URL("./prod-row-hash.sql", import.meta.url);

// Invented table rows; the fake psql prints them as the hash query would.
const rows = ["private.example_jobs\t2\taaaa", "public.example_lines\t5\tbbbb", "public.example_notes\t0\tcccc"];

function run({ printed = rows, baseline = null, fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "row-hash-"));
  const log = join(dir, "args");
  const out = join(dir, "out.tsv");
  writeFileSync(out, `${printed.join("\n")}\n`);
  writeFileSync(
    join(dir, "psql"),
    `#!/bin/bash
printf '%s\\n' "\$@" >> ${JSON.stringify(log)}
if [[ ${JSON.stringify(String(fail))} == true ]]; then exit 1; fi
cat ${JSON.stringify(out)}
`,
  );
  chmodSync(join(dir, "psql"), 0o755);
  const args = [script.pathname];
  if (baseline != null) {
    const file = join(dir, "baseline.tsv");
    writeFileSync(file, `${baseline.join("\n")}\n`);
    args.push(file);
  }
  const result = spawnSync("bash", args, {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_DB_URL: "postgresql://postgres@127.0.0.1:54322/postgres" },
  });
  let called = "";
  try {
    called = readFileSync(log, "utf8");
  } catch {
    called = "";
  }
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, called };
}

test("the hash query only reads and never prints row values", () => {
  const sql = readFileSync(query, "utf8");
  assert.match(sql, /md5\(coalesce\(string_agg\(r::text/);
  assert.match(sql, /order by r::text/);
  assert.match(sql, /'public', 'private'/);
  assert.equal(/\b(insert|update|delete|truncate|create|drop|alter)\b/i.test(sql.replace(/^--.*$/gm, "")), false);
  const shell = readFileSync(script, "utf8");
  assert.match(shell, /SET TRANSACTION READ ONLY/);
  assert.match(shell, /SET LOCAL timezone = 'UTC'/);
  assert.match(shell, /SET LOCAL datestyle = 'ISO, YMD'/);
});

test("without a baseline it prints the current hashes", () => {
  const out = run();
  assert.equal(out.status, 0);
  assert.equal(out.stdout, `${rows.join("\n")}\n`);
  assert.match(out.called, /SET TRANSACTION READ ONLY/);
  assert.match(out.called, /prod-row-hash\.sql/);
});

test("with the same baseline it says the hashes match", () => {
  const out = run({ baseline: rows });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /Row hashes match the baseline/);
});

test("with a different baseline it lists changed, new and gone tables", () => {
  const out = run({
    baseline: ["private.example_jobs\t2\taaaa", "public.example_lines\t4\tdddd", "public.example_old\t3\teeee"],
  });
  assert.equal(out.status, 2);
  assert.equal(
    out.stdout,
    [
      "changed\tpublic.example_lines\trows 4 -> 5",
      "new\tpublic.example_notes\trows 0",
      "gone\tpublic.example_old\trows 3",
    ]
      .sort((a, b) => a.split("\t")[1].localeCompare(b.split("\t")[1]))
      .join("\n") + "\n",
  );
});

test("a missing url, an unreadable baseline or a failed query stop with exit 1", () => {
  const noUrl = spawnSync("bash", [script.pathname], { encoding: "utf8", env: { ...process.env, SUPABASE_DB_URL: "" } });
  assert.equal(noUrl.status, 1);
  const noFile = spawnSync("bash", [script.pathname, "/nonexistent/baseline.tsv"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_DB_URL: "postgresql://x" },
  });
  assert.equal(noFile.status, 1);
  const dir = mkdtempSync(join(tmpdir(), "row-hash-empty-"));
  const empty = join(dir, "empty.tsv");
  writeFileSync(empty, "");
  const emptyBaseline = spawnSync("bash", [script.pathname, empty], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_DB_URL: "postgresql://x" },
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(emptyBaseline.status, 1);
  assert.match(emptyBaseline.stderr, /missing or empty/);
  const failed = run({ fail: true });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /the hash query failed/);
});
