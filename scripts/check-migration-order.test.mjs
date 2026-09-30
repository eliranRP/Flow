import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lockLines, migrationFiles, migrationHashes, migrationOrderProblems } from "./check-migration-order.mjs";

const files = migrationFiles();
const lock = lockLines(readFileSync(new URL("../supabase/migrations.lock", import.meta.url), "utf8"));
const hashes = migrationHashes(files);

function names(lines) {
  return lines.map((line) => line.split(" ")[0]);
}

test("the migration lock matches the directory, the file bytes, and the production schema_v1 version", () => {
  assert.deepEqual(migrationOrderProblems(files, lock, null, hashes), []);
  assert.equal(files[0], "20260928080538_schema_v1.sql");
  assert.equal(files.includes("20260927120000_schema_v1.sql"), false);
  assert.equal(files.length, 30);
  assert.match(lock[0], /^20260928080538_schema_v1\.sql [0-9a-f]{64}$/);
});

test("a rename, a removal, a content change, or an inserted version fails, and an append is allowed", () => {
  const renamed = [...lock];
  renamed[0] = `20260927120000_schema_v1.sql ${lock[0].split(" ")[1]}`;
  assert.ok(migrationOrderProblems(names(renamed), renamed, lock).some((line) => line.includes("renamed")));

  assert.ok(migrationOrderProblems(names(lock.slice(1)), lock.slice(1), lock).some((line) => line.includes("removed")));

  const changed = [...lock];
  changed[1] = `${names(lock)[1]} ${"a".repeat(64)}`;
  assert.ok(migrationOrderProblems(names(changed), changed, lock).some((line) => line.includes("content changed")));

  const inserted = [...lock];
  inserted.splice(2, 0, `20260928090000_middle.sql ${"b".repeat(64)}`);
  assert.ok(migrationOrderProblems(names(inserted), inserted, lock).some((line) => line.includes("renamed, removed, or reordered")));

  const appended = [...lock, `20260930150000_next.sql ${"c".repeat(64)}`];
  assert.deepEqual(migrationOrderProblems(names(appended), appended, lock), []);

  const early = [...lock, `20260928080537_too_early.sql ${"d".repeat(64)}`];
  assert.ok(migrationOrderProblems(names(early), early, lock).some((line) => line.includes("sorts at or before")));
  assert.ok(migrationOrderProblems(files, ["nope.sql"], null).some((line) => line.includes("does not match")));

  const drifted = { ...hashes, [files[1]]: "e".repeat(64) };
  assert.ok(migrationOrderProblems(files, lock, null, drifted).some((line) => line.includes("sha256 does not match")));
});
