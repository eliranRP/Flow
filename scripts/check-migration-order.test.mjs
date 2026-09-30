import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lockLines, migrationFiles, migrationOrderProblems } from "./check-migration-order.mjs";

const files = migrationFiles();
const lock = lockLines(readFileSync(new URL("../supabase/migrations.lock", import.meta.url), "utf8"));

test("the migration lock matches the directory and keeps schema_v1 at the production version", () => {
  assert.deepEqual(migrationOrderProblems(files, lock, null), []);
  assert.equal(files[0], "20260928080538_schema_v1.sql");
  assert.equal(files.includes("20260927120000_schema_v1.sql"), false);
  assert.equal(files.length, 29);
});

test("a rename, a removal, or an inserted version fails, and an append is allowed", () => {
  const renamed = [...lock];
  renamed[0] = "20260927120000_schema_v1.sql";
  assert.ok(migrationOrderProblems(renamed, renamed, lock).some((line) => line.includes("renamed")));

  assert.ok(migrationOrderProblems(lock.slice(1), lock.slice(1), lock).some((line) => line.includes("removed")));

  const inserted = [...lock];
  inserted.splice(2, 0, "20260928090000_middle.sql");
  assert.ok(migrationOrderProblems(inserted, inserted, lock).some((line) => line.includes("renamed, removed, or reordered")));

  const appended = [...lock, "20260930040000_next.sql"];
  assert.deepEqual(migrationOrderProblems(appended, appended, lock), []);

  const early = [...lock, "20260928080537_too_early.sql"];
  assert.ok(migrationOrderProblems(early, early, lock).some((line) => line.includes("sorts at or before")));
  assert.ok(migrationOrderProblems(files, ["nope.sql"], null).some((line) => line.includes("does not match")));
});
