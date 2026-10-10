#!/usr/bin/env node
// The story files a set of changed files reaches, for the pre-push every-story check.
// Usage: git diff --name-only <base> HEAD | node scripts/storybook-stories.mjs --index <index.json> [--budget N] [--base <base>]
//        git diff --name-only <base> HEAD | node scripts/storybook-stories.mjs --setup [--base <base>]  (prints yes or no)
//        git diff --name-status <base> HEAD -- <app inputs> | node scripts/storybook-stories.mjs --related-run [--base <base>]
// Prints the story files to open, one per line as Storybook's index names them (./src/x.stories.tsx),
// or "all" when a change reaches every story (the Storybook config, the lockfile, the smoke itself),
// and a last line "partial" when the budget left some reached stories to main.
// Tier 1: a changed story file. Tier 2: a story that imports a changed file. Tier 3: a story whose
// imports reach one further down. Whole tiers are taken, nearest first, while their stories fit the
// budget (default 250); the first tier is always taken.
// CSS picks no story: the every-story check looks for console and network errors, which CSS
// can't cause; the layout specs run whenever the app changes.
// With --base, a package manifest, tsconfig or the lockfile picks all only when the part the
// Storybook build reads changed (see reachesBuild); without it, any change to one picks all.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importWalker } from "./e2e-specs.mjs";

const runsAll = [
  /^app\/\.storybook\//,
  /^app\/(vite\.config\.ts|playwright\.storybook\.config\.ts)$/,
  /^app\/e2e\/storybook-[^/]+$/,
  /^scripts\/(storybook-stories|e2e-specs)\.mjs$/,
];

/** The parts of a JSON file the Storybook build reads, or null when it does not parse. */
function jsonParts(text, pick) {
  try {
    return JSON.stringify(pick(JSON.parse(text)));
  } catch {
    return null;
  }
}

const scriptsMatching = (scripts = {}, names) =>
  Object.fromEntries(Object.entries(scripts).filter(([name]) => names.test(name)).sort());

/** A pnpm-lock.yaml importer block ("  app:" up to the next importer), or "" when absent. */
function importerBlock(text, importer) {
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${importer}:`);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^ {0,2}\S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

/** Text before the lockfile's importers: settings and overrides, which change every install. */
const lockHead = (text) => text.slice(0, Math.max(0, text.indexOf("\nimporters:")));

// Files whose change reaches the Storybook build or the vitest runs only through some of their
// content: the part each rule returns, with the scripts whose names match `scripts` (the ones that
// start that build or run). The root importer and the root package's other fields are the
// workspace's tools (lint, wrangler, type generation), which neither ever loads.
const manifestParts = (scripts) => [
  [/^(app|packages\/shared)\/package\.json$/, (text) => jsonParts(text, (pkg) =>
    [pkg.type, pkg.exports, pkg.main, pkg.dependencies, pkg.devDependencies, scriptsMatching(pkg.scripts, scripts)])],
  [/^package\.json$/, (text) => jsonParts(text, (pkg) => [pkg.pnpm, scriptsMatching(pkg.scripts, scripts)])],
  [/^(app\/tsconfig[^/]*|packages\/shared\/tsconfig[^/]*|tsconfig\.base)\.json$/, (text) =>
    jsonParts(text, (config) => [config.extends, config.compilerOptions])],
  [/^pnpm-lock\.yaml$/, (text) => [lockHead(text), importerBlock(text, "app"), importerBlock(text, "packages/shared")].join("\n")],
];
const buildParts = manifestParts(/storybook/);
const testParts = manifestParts(/storybook|^test(:unit)?$/);

function readAt(root, ref, file) {
  try {
    return ref == null
      ? fs.readFileSync(path.join(root, file), "utf8")
      : execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * Whether a change to one file reaches every story: the Storybook setup, the smoke itself, or the
 * part of a manifest, tsconfig or lockfile the build reads. Without a base, or when the file is new,
 * deleted or does not parse on either side, a manifest change reaches every story.
 * @param {string} file repo-relative
 * @param {{ root: string, base?: string }} options
 */
export function reachesBuild(file, { root, base }) {
  if (runsAll.some((pattern) => pattern.test(file))) return true;
  return partsChanged(buildParts, file, { root, base }) ?? false;
}

/**
 * For a manifest, tsconfig or lockfile: whether the change reaches what the vitest runs read
 * (dependencies, test and storybook scripts, compiler options, the app's and the shared package's
 * lockfile entries). null for any other file.
 * @param {string} file repo-relative
 * @param {{ root: string, base?: string }} options
 */
export function reachesTests(file, { root, base }) {
  return partsChanged(testParts, file, { root, base });
}

/** true or false for a file one of the rules covers (true without a base), else null. */
function partsChanged(rules, file, { root, base }) {
  const rule = rules.find(([pattern]) => pattern.test(file));
  if (!rule) return null;
  if (!base) return true;
  const before = readAt(root, base, file);
  const after = readAt(root, null, file);
  if (before == null || after == null) return true;
  const [partsBefore, partsAfter] = [rule[1](before), rule[1](after)];
  return partsBefore == null || partsAfter == null || partsBefore !== partsAfter;
}

/** Every story file under app/src, repo-relative. */
function storyFiles(root, folder = "app/src/") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const rel = `${folder}${entry.name}`;
    if (entry.isDirectory()) out.push(...storyFiles(root, `${rel}/`));
    else if (/\.stories\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

/**
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, base?: string }} options
 * @returns {Array<[number, string]> | "all"} [tier, story file as ./src/...], tier 1 first
 */
export function selectStories(changed, { root, base }) {
  if (changed.some((file) => reachesBuild(file, { root, base }))) return "all";
  const sources = new Set(changed.filter((file) => /\.(ts|tsx|json)$/.test(file)));
  if (sources.size === 0) return [];
  const walk = importWalker(root);
  /** @type {Array<[number, string]>} */
  const out = [];
  for (const story of storyFiles(root)) {
    let tier = 0;
    if (sources.has(story)) tier = 1;
    else if ([...walk([story], (file) => file !== story)].some((file) => sources.has(file))) tier = 2;
    else if ([...walk([story])].some((file) => sources.has(file))) tier = 3;
    if (tier > 0) out.push([tier, `./${story.slice("app/".length)}`]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
}

// The pre-push vitest runs (unit and storybook) take only the tests related to a change
// (vitest --changed, which follows the module graph to every test and story a source reaches) when
// each changed app input is a source that graph follows, or a file no vitest test or story reads
// by import. Anything else runs every test: a removed or renamed file, the test setup, the
// Storybook or Vite config, the design package, a script, and (with a base) a manifest, tsconfig or
// lockfile change the tests read (reachesTests; without a base, any change to one).
// - CSS under app/src: no test imports it (the setup files load the whole stylesheet), so the
//   graph can't scope it. A stylesheet rarely breaks a test; the every-story check takes no story
//   for it either, and main runs every test before each deploy.
// - app/e2e: Playwright specs and their helpers; vitest reads only e2e/**/*.test.ts, which the
//   graph covers like any source.
const relatedSources =
  /^(app\/src|app\/e2e|packages\/shared\/src|supabase\/functions\/_shared)\/.*\.tsx?$|^supabase\/migrations\/[^/]+\.sql$/;
const unread = /^app\/src\/.*\.css$/;

/**
 * @param {string[]} nameStatus lines of `git diff --name-status <base> HEAD -- <app inputs>`
 * @param {{ root?: string, base?: string }} [options] with a base, a modified manifest, tsconfig or
 *   lockfile counts only when the part the tests read changed (reachesTests)
 * @returns {boolean} true when the related tests are enough
 */
export function relatedRun(nameStatus, { root, base } = {}) {
  for (const line of nameStatus) {
    const [status, file] = line.split("\t");
    if (!/^[AM]$/.test(status ?? "") || !file) return false;
    if (file === "app/src/test-setup.ts") return false;
    if (status === "M" && base && root && reachesTests(file, { root, base }) === false) continue;
    if (!relatedSources.test(file) && !unread.test(file)) return false;
  }
  return true;
}

/**
 * @param {Array<[number, string]>} tiered from selectStories
 * @param {Map<string, number>} counts stories per file, from Storybook's index
 * @param {number} budget
 * @returns {{ files: string[], partial: boolean }}
 */
export function pickStories(tiered, counts, budget) {
  const files = [];
  let count = 0;
  for (const tier of [...new Set(tiered.map(([t]) => t))]) {
    const inTier = tiered.filter(([t]) => t === tier).map(([, file]) => file);
    const size = inTier.reduce((sum, file) => sum + (counts.get(file) ?? 0), 0);
    if (files.length > 0 && count + size > budget) return { files, partial: true };
    files.push(...inTier);
    count += size;
  }
  return { files, partial: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const arg = (name) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  if (process.argv.includes("--related-run")) {
    // git diff --name-status on stdin; prints "related" or "all".
    const lines = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
    console.log(relatedRun(lines, { root, base: arg("--base") }) ? "related" : "all");
    process.exit(0);
  }
  const changed = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const base = arg("--base");
  const indexPath = arg("--index");
  if (process.argv.includes("--setup")) {
    console.log(changed.some((file) => reachesBuild(file, { root, base })) ? "yes" : "no");
  } else if (!indexPath) {
    throw new Error("usage: storybook-stories.mjs --index <index.json> [--budget N] [--base <base>]");
  } else {
    printStories(selectStories(changed, { root, base }), indexPath, Number(arg("--budget") ?? "250"));
  }
}

function printStories(stories, indexPath, budget) {
  if (stories === "all") {
    console.log("all");
  } else {
    const counts = new Map();
    for (const entry of Object.values(JSON.parse(fs.readFileSync(indexPath, "utf8")).entries)) {
      if (entry.type === "story") counts.set(entry.importPath, (counts.get(entry.importPath) ?? 0) + 1);
    }
    // A story file the index doesn't name means the paths drifted: fail rather than open nothing.
    const missing = stories.filter(([, file]) => !counts.has(file)).map(([, file]) => file);
    if (missing.length > 0) throw new Error(`not in Storybook's index: ${missing.join(", ")}`);
    const { files, partial } = pickStories(stories, counts, budget);
    for (const file of files) console.log(file);
    if (partial) console.log("partial");
  }
}
