/**
 * The PWA bundle must not contain the Jev key's name or the Vault read path.
 *
 * Secret name: jev_api_key
 * Scope: the TypeSafe Jev API bearer key. One project-wide server secret.
 * It is not a per-company key, not the SUMIT key, and not an Edge Function env var.
 *
 * Exit codes:
 * 0 clean
 * 1 a scanned file contains a needle
 * 2 incomplete: no directory to scan, or a path is missing
 * 3 crash
 *
 * `--crash` is the crash probe. It is not a scan result.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

export const jevBundleNeedles = [
  "jev_api_key",
  "JEV_API_KEY",
  "vault.decrypted_secrets",
  "read_jev_api_key",
];

export const SECRET_LINE = "secret jev_api_key scope=typesafe-jev-api-bearer server-only";

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function jevBundleViolations(dir) {
  /** @type {string[]} */
  const found = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const body = readFileSync(full);
      const text = body.toString("utf8");
      for (const needle of jevBundleNeedles) {
        if (text.includes(needle)) found.push(`${full} contains ${needle}`);
      }
    }
  };
  walk(dir);
  return found;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function runJevBundleCheck(argv) {
  console.log(SECRET_LINE);
  if (argv.includes("--crash")) {
    throw new Error("crash probe");
  }
  const dirs = argv.filter((arg) => arg !== "--crash");
  const targets = dirs.length > 0 ? dirs : ["app/dist"];
  if (targets.length === 0) return 2;
  /** @type {string[]} */
  const problems = [];
  for (const dir of targets) {
    let info;
    try {
      info = statSync(dir);
    } catch {
      console.error(`incomplete: ${dir} is missing`);
      return 2;
    }
    if (!info.isDirectory()) {
      console.error(`incomplete: ${dir} is not a directory`);
      return 2;
    }
    problems.push(...jevBundleViolations(dir));
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    return 1;
  }
  console.log(`clean ${targets.join(" ")}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
  try {
    process.exit(runJevBundleCheck(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "crash");
    process.exit(3);
  }
}
