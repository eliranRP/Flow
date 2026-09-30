/**
 * Migration filenames are the versions Supabase records.
 * The lock stores each filename and the sha256 of that file.
 * Against the lock on main, a change may only append a new file.
 * An existing filename and its sha256 stay put.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase/migrations");
const lockPath = path.join(root, "supabase/migrations.lock");
const filename = /^[0-9]{14}_[a-z0-9_]+\.sql$/;
const lockEntry = /^([0-9]{14}_[a-z0-9_]+\.sql) ([0-9a-f]{64})$/;

/** @param {string} text */
export function lockLines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

/** @param {Buffer | string} bytes */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {string} line
 * @returns {{ name: string, hash: string } | null}
 */
export function parseLockEntry(line) {
  const match = lockEntry.exec(line);
  if (!match) return null;
  return { name: match[1], hash: match[2] };
}

/**
 * @param {string[]} files directory order
 * @param {string[]} lock filename and sha256 lines
 * @param {string[] | null} base lock from the base branch, or null when that file does not exist yet
 * @param {Record<string, string> | null} [hashes] sha256 of each migration file, when the bytes are available
 * @returns {string[]}
 */
export function migrationOrderProblems(files, lock, base, hashes = null) {
  /** @type {string[]} */
  const problems = [];
  for (const name of files) {
    if (!filename.test(name)) problems.push(`${name} is not a migration filename`);
  }
  const sorted = [...files].sort();
  if (files.join("\n") !== sorted.join("\n")) problems.push("migration files are not in filename order");

  /** @type {{ name: string, hash: string }[]} */
  const locked = [];
  for (const line of lock) {
    const entry = parseLockEntry(line);
    if (!entry) {
      problems.push(`supabase/migrations.lock entry is not a filename and sha256: ${line}`);
      continue;
    }
    locked.push(entry);
  }
  if (files.join("\n") !== locked.map((entry) => entry.name).join("\n")) {
    problems.push("supabase/migrations.lock does not match supabase/migrations");
  }
  if (hashes) {
    for (const entry of locked) {
      if (hashes[entry.name] !== entry.hash) problems.push(`${entry.name} sha256 does not match the file`);
    }
  }
  if (!base || base.length === 0) return problems;

  /** @type {{ name: string, hash: string }[]} */
  const baseLocked = [];
  for (const line of base) {
    const entry = parseLockEntry(line);
    if (!entry) {
      problems.push(`base lock entry is not a filename and sha256: ${line}`);
      return problems;
    }
    baseLocked.push(entry);
  }
  const shared = Math.min(baseLocked.length, locked.length);
  for (let index = 0; index < shared; index += 1) {
    const current = locked[index];
    const previous = baseLocked[index];
    if (!current || current.name !== previous.name) {
      problems.push(`${previous.name} was renamed, removed, or reordered`);
      return problems;
    }
    if (current.hash !== previous.hash) {
      problems.push(`${previous.name} content changed`);
      return problems;
    }
  }
  if (locked.length < baseLocked.length) {
    problems.push(`${baseLocked[locked.length].name} was removed`);
    return problems;
  }
  const last = baseLocked[baseLocked.length - 1]?.name.slice(0, 14) ?? "";
  for (const entry of locked.slice(baseLocked.length)) {
    if (entry.name.slice(0, 14) <= last) problems.push(`${entry.name} sorts at or before the last locked migration`);
  }
  return problems;
}

/** @returns {string[]} */
export function migrationFiles() {
  return readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
}

/** @param {string[]} files */
export function migrationHashes(files) {
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const name of files) {
    hashes[name] = sha256(readFileSync(path.join(migrationsDir, name)));
  }
  return hashes;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const baseFlag = process.argv.indexOf("--base");
  const baseArg = baseFlag >= 0 ? process.argv[baseFlag + 1] : "";
  const base = baseArg ? lockLines(readFileSync(baseArg, "utf8")) : null;
  const files = migrationFiles();
  const problems = migrationOrderProblems(files, lockLines(readFileSync(lockPath, "utf8")), base, migrationHashes(files));
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(base && base.length > 0
    ? "migration filenames and sha256 values are unchanged except for appended files"
    : "migration filenames and sha256 values match supabase/migrations.lock");
}
