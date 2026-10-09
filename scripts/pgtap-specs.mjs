#!/usr/bin/env node
// FLOW-813: the pgTAP files a change reaches. Reads changed paths on stdin and prints the
// supabase/tests/database files to run: each changed test file, and each test that names a
// function, table, view, type or trigger that a changed migration touches; every file when a changed
// migration names none, or the helpers or seed changed. Main runs them all.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TESTS = "supabase/tests/database";

const NAME = String.raw`(?:"?\w+"?\.)?"?(\w+)"?`;
const PATTERNS = [
  new RegExp(String.raw`\bfunction\s+(?:if\s+exists\s+)?${NAME}\s*[(;]`, "gi"),
  new RegExp(String.raw`\b(?:table|view|type)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?${NAME}`, "gi"),
  new RegExp(String.raw`\btrigger\s+(?:if\s+exists\s+)?${NAME}`, "gi"),
  // A policy, index or trigger names its table after "on".
  new RegExp(String.raw`\b(?:policy|index|trigger)\b[^;]*?\bon\s+(?:table\s+)?(?:only\s+)?${NAME}`, "gi"),
  // The in-place patch style names its function as 'public.x(...)'::regprocedure.
  new RegExp(String.raw`'(?:\w+\.)?(\w+)\s*\([^']*\)'::regproc`, "gi"),
];
/** Words the patterns also catch that name no object, and anchor_count, the pg_temp patch helper. */
const NOT_NAMES = new Set(["if", "only", "exists", "as", "returns", "on", "public", "private", "language", "anchor_count"]);

/** The function, table, view and trigger names a migration's SQL creates, alters or drops. */
export function namesIn(sql) {
  const names = new Set();
  const text = sql.replace(/--[^\n]*/g, "").replace(/\breturns\s+(?:setof\s+)?(?:table|trigger)\b/gi, "returns");
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.toLowerCase();
      if (name && name.length > 2 && !NOT_NAMES.has(name)) names.add(name);
    }
  }
  return names;
}

/** The test files to run for the changed paths, given each test's name and text. */
export function pgtapSpecs(changed, tests, readMigration) {
  const picked = new Set();
  const names = new Set();
  if (changed.some((path) => /^supabase\/(tests\/[^/]+\.sql|seed\.sql|config\.toml)$/.test(path))) return [...tests.keys()].sort();
  for (const path of changed) {
    if (path.startsWith(`${TESTS}/`) && path.endsWith(".sql") && tests.has(path)) picked.add(path);
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(path)) {
      const sql = readMigration(path);
      if (sql == null) continue;
      const found = namesIn(sql);
      // A migration that names no object (a data fix, a seed) could reach any test: run them all.
      if (found.size === 0) return [...tests.keys()].sort();
      for (const name of found) names.add(name);
    }
  }
  if (names.size > 0) {
    const words = new RegExp(String.raw`\b(?:${[...names].join("|")})\b`, "i");
    for (const [path, text] of tests) if (words.test(text)) picked.add(path);
  }
  return [...picked].sort();
}

function main() {
  const changed = readFileSync(0, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const tests = new Map();
  for (const file of readdirSync(TESTS)) {
    if (file.endsWith(".sql")) tests.set(`${TESTS}/${file}`, readFileSync(join(TESTS, file), "utf8"));
  }
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  for (const path of pgtapSpecs(changed, tests, read)) console.log(path);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
