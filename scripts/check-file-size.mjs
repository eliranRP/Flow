/**
 * CONTRIBUTING "File size": a code file may have at most 800 lines, a test file 1,200.
 * Migrations are append-only history and generated files are exempt. A file that has to
 * stay over its limit goes in file-size-allow.txt with its current line count; it may
 * shrink but not grow, and its entry has to go once it is under the limit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const codeLimit = 800;
export const testLimit = 1200;

const codeFile = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|sh|css|py)$/;
// Test helpers outside supabase/tests and app/e2e (test-support.ts, *_test_support.ts) are held to 800.
const testFile = /(\.test\.|\.spec\.|_test\.)[^/]*$|^supabase\/tests\/|^app\/e2e\//;
const exempt = [/^supabase\/migrations\//, /^packages\/shared\/src\/database\.types\.ts$/];

/** @param {string} file */
export function limitFor(file) {
  if (!codeFile.test(file) || exempt.some((re) => re.test(file))) return null;
  return testFile.test(file) ? testLimit : codeLimit;
}

/**
 * Each line is `<lines> <path>`, optionally followed by `# reason`.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function parseAllowlist(text) {
  /** @type {Map<string, number>} */
  const allowed = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const match = /^(\d+)\s+(\S+)$/.exec(line);
    if (!match) throw new Error(`file-size-allow.txt: cannot read "${raw}"`);
    allowed.set(match[2], Number(match[1]));
  }
  return allowed;
}

/**
 * @param {{ file: string, lines: number }[]} files
 * @param {Map<string, number>} allowed
 * @returns {string[]}
 */
export function fileSizeProblems(files, allowed) {
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  for (const { file, lines } of files) {
    const limit = limitFor(file);
    if (limit === null) continue;
    seen.add(file);
    const cap = allowed.get(file);
    if (cap === undefined) {
      if (lines > limit) problems.push(`${file}: ${lines} lines, the limit is ${limit}. Split it (CONTRIBUTING "File size").`);
    } else if (lines <= limit) {
      problems.push(`${file}: ${lines} lines is under the limit of ${limit} now; remove it from scripts/file-size-allow.txt.`);
    } else if (lines > cap) {
      problems.push(`${file}: ${lines} lines, its allowed size is ${cap}. A file over the limit may not grow.`);
    }
  }
  for (const file of allowed.keys()) {
    if (!seen.has(file)) problems.push(`${file}: listed in scripts/file-size-allow.txt but not a checked file; remove the entry.`);
  }
  return problems;
}

/** @param {string} root */
export function repoFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\0")
    // A tracked file deleted in a dirty working tree is skipped, not read.
    .filter((file) => file && limitFor(file) !== null && existsSync(path.join(root, file)))
    .map((file) => {
      const text = readFileSync(path.join(root, file), "utf8");
      const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      return { file, lines };
    });
}

/** @param {string} root */
export function repoProblems(root) {
  const allowed = parseAllowlist(readFileSync(path.join(root, "scripts/file-size-allow.txt"), "utf8"));
  return fileSizeProblems(repoFiles(root), allowed);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = repoProblems(root);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log("file sizes: every code file is within 800 lines and every test file within 1,200");
}
