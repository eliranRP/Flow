/**
 * Repo-wide deny-list check (FLOW-901).
 * MERCURY_FIXTURE_DENYLIST is an Actions secret: one real name or code per line, any number of words.
 * Every tracked text file is read as one stream of words (lowercase, NFKD, diacritics stripped,
 * split on anything that is not a letter or a digit), so punctuation and line breaks between the
 * words of an entry do not hide it. A hit prints only the file and the line, never the text.
 * Without the secret the check skips, except in CI on eliranRP/Flow, where it is required.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;

/** @param {string} text */
export function words(text) {
  const stripped = text.normalize("NFKD").replace(/\p{M}+/gu, "");
  return stripped.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

/** @param {string | undefined} raw */
export function denyEntries(raw) {
  const entries = new Map();
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const entry = words(line);
    if (entry.length > 0) entries.set(entry.join(" "), entry);
  }
  return [...entries.values()];
}

/** @param {{ get(name: string): string | undefined }} env */
export function denyListRequired(env) {
  if (env.get("GITHUB_ACTIONS") !== "true") return false;
  if ((env.get("GITHUB_REPOSITORY") ?? "").toLowerCase() !== "eliranrp/flow") return false;
  return env.get("GITHUB_EVENT_HEAD_REPO_FORK") !== "true";
}

/**
 * Lines (1-based) where a denied entry starts; an entry may run across lines.
 * @param {string} text
 * @param {string[][]} entries
 */
export function deniedLines(text, entries) {
  /** @type {Map<string, string[][]>} */
  const byFirst = new Map();
  for (const entry of entries) {
    const list = byFirst.get(entry[0]) ?? [];
    list.push(entry);
    byFirst.set(entry[0], list);
  }
  const stream = [];
  const lineOf = [];
  text.split("\n").forEach((line, index) => {
    for (const word of words(line)) {
      stream.push(word);
      lineOf.push(index + 1);
    }
  });
  const hits = new Set();
  for (let at = 0; at < stream.length; at += 1) {
    for (const entry of byFirst.get(stream[at]) ?? []) {
      if (entry.every((word, offset) => stream[at + offset] === word)) hits.add(lineOf[at]);
    }
  }
  return [...hits].sort((a, b) => a - b);
}

/**
 * @param {string} dir
 * @param {string[]} files paths relative to dir
 * @param {string[][]} entries
 */
export function scanFiles(dir, files, entries) {
  const hits = [];
  for (const file of files) {
    if (binary.test(file)) continue;
    let text;
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of deniedLines(text, entries)) hits.push(`${file}:${line}`);
  }
  return hits;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = { get: (/** @type {string} */ name) => process.env[name] };
  const entries = denyEntries(process.env.MERCURY_FIXTURE_DENYLIST);
  if (entries.length === 0) {
    if (denyListRequired(env)) {
      console.error("check-deny-list: MERCURY_FIXTURE_DENYLIST is required in CI on eliranRP/Flow");
      process.exit(1);
    }
    console.log("check-deny-list: skipped, MERCURY_FIXTURE_DENYLIST is not set");
    process.exit(0);
  }
  const files = trackedFiles();
  const hits = scanFiles(root, files, entries);
  if (hits.length > 0) {
    console.error(`check-deny-list: ${hits.length} denied name(s) found (file:line only):`);
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log(`check-deny-list: ${files.length} tracked files, no denied names`);
}
