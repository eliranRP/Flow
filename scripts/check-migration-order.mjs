/**
 * Migration filenames are the versions Supabase records.
 * Renaming or reordering one makes a later db push refuse the remote history.
 * The lock matches the directory. Against the lock on main, changes may only append.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const lockPath = path.join(root, "supabase/migrations.lock");
const filename = /^[0-9]{14}_[a-z0-9_]+\.sql$/;

/** @param {string} text */
export function lockLines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

/**
 * @param {string[]} files directory order
 * @param {string[]} lock
 * @param {string[] | null} base lock from the base branch, or null when that file does not exist yet
 * @returns {string[]}
 */
export function migrationOrderProblems(files, lock, base) {
  /** @type {string[]} */
  const problems = [];
  for (const name of files) {
    if (!filename.test(name)) problems.push(`${name} is not a migration filename`);
  }
  const sorted = [...files].sort();
  if (files.join("\n") !== sorted.join("\n")) problems.push("migration files are not in filename order");
  if (files.join("\n") !== lock.join("\n")) {
    problems.push("supabase/migrations.lock does not match supabase/migrations");
  }
  if (!base || base.length === 0) return problems;
  const shared = Math.min(base.length, files.length);
  for (let index = 0; index < shared; index += 1) {
    if (files[index] !== base[index]) {
      problems.push(`${base[index]} was renamed, removed, or reordered`);
      return problems;
    }
  }
  if (files.length < base.length) {
    problems.push(`${base[files.length]} was removed`);
    return problems;
  }
  const last = base[base.length - 1]?.slice(0, 14) ?? "";
  for (const name of files.slice(base.length)) {
    if (name.slice(0, 14) <= last) problems.push(`${name} sorts at or before the last locked migration`);
  }
  return problems;
}

/** @returns {string[]} */
export function migrationFiles() {
  return readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const baseFlag = process.argv.indexOf("--base");
  const baseArg = baseFlag >= 0 ? process.argv[baseFlag + 1] : "";
  const base = baseArg ? lockLines(readFileSync(baseArg, "utf8")) : null;
  const problems = migrationOrderProblems(migrationFiles(), lockLines(readFileSync(lockPath, "utf8")), base);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(base && base.length > 0
    ? "migration filenames are unchanged except for appended files"
    : "migration filenames match supabase/migrations.lock");
}
