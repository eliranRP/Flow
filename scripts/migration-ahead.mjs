/**
 * FLOW-814. A branch's new migration must sort after the last one on main. When a newer migration
 * merges to main first, the branch has to rename its own, and the full gate used to find that out
 * only after ~9 minutes. This check runs first in scripts/local-ci.sh and fails in seconds.
 *
 *   node scripts/migration-ahead.mjs            check the branch's new migrations against origin/main
 *   node scripts/migration-ahead.mjs --rename   rename them to main's latest date prefix + the current
 *                                               UTC HHMMSS, fix the files that name them, rewrite the lock
 *
 * The branch's new migrations are the files in supabase/migrations that main's lock does not name, so
 * both work before and after a merge of origin/main, and --rename also settles a conflicted lock.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendedMigrationHourProblem,
  lockLines,
  migrationFiles,
  migrationHashes,
  parseLockEntry,
} from "./check-migration-order.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const lockPath = path.join(root, "supabase/migrations.lock");
const fix = "node scripts/migration-ahead.mjs --rename";

/**
 * @param {string[]} mainLock lock lines on main
 * @param {string[]} files migration files here
 * @returns {{ last: string, mine: string[] }} main's last version and the files main does not have
 */
export function branchMigrations(mainLock, files) {
  const onMain = new Set(mainLock.map((line) => parseLockEntry(line)?.name ?? line.split(" ")[0]));
  const last = [...onMain].sort().at(-1)?.slice(0, 14) ?? "";
  return { last, mine: files.filter((name) => !onMain.has(name)).sort() };
}

/**
 * @param {string[]} mainLock
 * @param {string[]} files
 * @returns {string[]}
 */
export function aheadProblems(mainLock, files) {
  const { last, mine } = branchMigrations(mainLock, files);
  /** @type {string[]} */
  const problems = [];
  for (const name of mine) {
    if (name.slice(0, 14) <= last) problems.push(`${name} sorts at or before main's last migration (${last})`);
    const hour = appendedMigrationHourProblem(name);
    if (hour) problems.push(hour);
  }
  return problems;
}

/** @param {string} version YYYYMMDDHHmmss, read as UTC; an hour past 23 rolls into the next day */
function versionTime(version) {
  const part = (/** @type {number} */ from, /** @type {number} */ to) => Number(version.slice(from, to));
  return Date.UTC(part(0, 4), part(4, 6) - 1, part(6, 8), part(8, 10), part(10, 12), part(12, 14));
}

/** @param {number} time */
function timeVersion(time) {
  return new Date(time).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * New names for the branch's migrations: main's latest date prefix + the current UTC HHMMSS, or one
 * second after main's last when that would not sort after it, then one second apart, in their order.
 * @param {string} last main's last version
 * @param {string[]} mine the branch's migration files, sorted
 * @param {Date} now
 * @returns {[string, string][]} old and new name, only for the files that move
 */
export function renamePlan(last, mine, now) {
  const clock = now.toISOString().slice(11, 19).replace(/:/g, "");
  let next = last ? `${last.slice(0, 8)}${clock}` : timeVersion(now.getTime());
  if (last && next <= last) next = timeVersion(versionTime(last) + 1000);
  /** @type {[string, string][]} */
  const plan = [];
  for (const name of mine) {
    const renamed = `${next}${name.slice(14)}`;
    if (renamed !== name) plan.push([name, renamed]);
    next = timeVersion(versionTime(next) + 1000);
  }
  return plan;
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** @returns {string[] | null} */
function mainLock() {
  try {
    return lockLines(git(["show", "origin/main:supabase/migrations.lock"]));
  } catch {
    return null;
  }
}

/** Files the branch changes against main, plus uncommitted ones: where a renamed migration may be named. */
function changedFiles() {
  let names = "";
  for (const args of [["diff", "--name-only", "origin/main...HEAD"], ["diff", "--name-only", "HEAD"]]) {
    try {
      names += git(args);
    } catch {
      // No merge base or no HEAD yet: nothing to add from this side.
    }
  }
  return [...new Set(names.split("\n").filter((name) => name.length > 0))];
}

function rename() {
  const main = mainLock();
  if (!main) {
    console.error("migration-ahead: origin/main has no supabase/migrations.lock; run git fetch origin main first.");
    process.exit(1);
  }
  const { last, mine } = branchMigrations(main, migrationFiles());
  const plan = renamePlan(last, mine, new Date());
  const tracked = new Set(git(["ls-files", "supabase/migrations"]).split("\n").map((name) => path.basename(name)));
  const others = changedFiles().filter((name) => !name.startsWith("supabase/migrations/"));
  /** @type {Set<string>} */
  const edited = new Set();
  for (const [from, to] of plan) {
    if (tracked.has(from)) git(["mv", "-f", `supabase/migrations/${from}`, `supabase/migrations/${to}`]);
    else renameSync(path.join(migrationsDir, from), path.join(migrationsDir, to));
    for (const file of others) {
      const full = path.join(root, file);
      if (!existsSync(full)) continue;
      const text = readFileSync(full, "utf8");
      const stem = from.replace(/\.sql$/, "");
      if (!text.includes(stem)) continue;
      writeFileSync(full, text.split(stem).join(to.replace(/\.sql$/, "")));
      edited.add(file);
    }
    console.log(`${from} -> ${to}`);
  }
  // The lock names every file in order with its sha256; main's lines come back unchanged.
  const files = migrationFiles();
  const hashes = migrationHashes(files);
  writeFileSync(lockPath, files.map((name) => `${name} ${hashes[name]}\n`).join(""));
  git(["add", "supabase/migrations", "supabase/migrations.lock", ...edited]);
  console.log(plan.length > 0
    ? "migration-ahead: renamed and staged with the lock; commit and push."
    : "migration-ahead: already after main's last migration; the lock is rewritten and staged.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--rename")) {
    rename();
  } else {
    const main = mainLock();
    if (!main) {
      console.log("migration-ahead: no origin/main lock to compare against; the full gate checks the order.");
    } else {
      const problems = aheadProblems(main, migrationFiles());
      if (problems.length > 0) {
        console.error(`${problems.join("\n")}\nA newer migration merged to main. Run: git merge origin/main && ${fix}, then commit and push.`);
        process.exit(1);
      }
      console.log("migration-ahead: the branch's migrations sort after main's last");
    }
  }
}
