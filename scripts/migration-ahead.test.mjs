import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aheadProblems, branchMigrations, renamePlan } from "./migration-ahead.mjs";

const hash = "0".repeat(64);
const mainLock = [
  `20261014141306_card_names.sql ${hash}`,
  `20261014144525_cash_line_parts.sql ${hash}`,
];

test("a branch with no new migration passes, and main's own files never count as the branch's", () => {
  const files = ["20261014141306_card_names.sql", "20261014144525_cash_line_parts.sql"];
  assert.deepEqual(branchMigrations(mainLock, files), { last: "20261014144525", mine: [] });
  assert.deepEqual(aheadProblems(mainLock, files), []);
});

test("a new migration after main's last passes, before the merge of main and after it", () => {
  assert.deepEqual(aheadProblems(mainLock, ["20261014141306_card_names.sql", "20261014150000_team_seats.sql"]), []);
  assert.deepEqual(aheadProblems(mainLock, [
    "20261014141306_card_names.sql",
    "20261014144525_cash_line_parts.sql",
    "20261014150000_team_seats.sql",
  ]), []);
});

test("a new migration that a newer one on main overtook fails, and so does an hour past 23", () => {
  assert.deepEqual(aheadProblems(mainLock, ["20261014141306_card_names.sql", "20261014143000_team_seats.sql"]), [
    "20261014143000_team_seats.sql sorts at or before main's last migration (20261014144525)",
  ]);
  assert.deepEqual(aheadProblems(mainLock, ["20261014241000_team_seats.sql"]), [
    "20261014241000_team_seats.sql hour is outside 00-23",
  ]);
});

test("rename uses main's date prefix with the current UTC time, one second apart", () => {
  const now = new Date("2026-10-10T15:20:07Z");
  assert.deepEqual(renamePlan("20261014144525", ["20261010143000_a.sql", "20261010143001_b.sql"], now), [
    ["20261010143000_a.sql", "20261014152007_a.sql"],
    ["20261010143001_b.sql", "20261014152008_b.sql"],
  ]);
});

test("rename steps past main's last when the clock would not sort after it, and skips a name already right", () => {
  const early = new Date("2026-10-10T09:00:00Z");
  assert.deepEqual(renamePlan("20261014144525", ["20261014143000_a.sql"], early), [
    ["20261014143000_a.sql", "20261014144526_a.sql"],
  ]);
  assert.deepEqual(renamePlan("20261014235959", ["20261014143000_a.sql"], early), [
    ["20261014143000_a.sql", "20261015000000_a.sql"],
  ]);
  assert.deepEqual(renamePlan("20261014144525", ["20261014152007_a.sql"], new Date("2026-10-10T15:20:07Z")), []);
});

test("local CI runs the check before installing anything", () => {
  const local = readFileSync(new URL("./local-ci.sh", import.meta.url), "utf8");
  const check = local.indexOf("node scripts/migration-ahead.mjs");
  assert.ok(check > 0);
  assert.ok(check < local.indexOf("pnpm install --frozen-lockfile"));
  assert.ok(local.indexOf("git fetch -q origin main") < check);
});
