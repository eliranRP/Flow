#!/usr/bin/env node
// The story files a set of changed files reaches, for the pre-push every-story check.
// Usage: git diff --name-only <base> HEAD | node scripts/storybook-stories.mjs --index <index.json> [--budget N]
//        git diff --name-status <base> HEAD -- <app inputs> | node scripts/storybook-stories.mjs --related-run
// Prints the story files to open, one per line as Storybook's index names them (./src/x.stories.tsx),
// or "all" when a change reaches every story (the Storybook config, the lockfile, the smoke itself),
// and a last line "partial" when the budget left some reached stories to main.
// Tier 1: a changed story file. Tier 2: a story that imports a changed file. Tier 3: a story whose
// imports reach one further down. Whole tiers are taken, nearest first, while their stories fit the
// budget (default 250); the first tier is always taken.
// CSS picks no story: the every-story check looks for console and network errors, which CSS
// can't cause; the layout specs run whenever the app changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importWalker } from "./e2e-specs.mjs";

const runsAll = [
  /^app\/\.storybook\//,
  /^app\/(package\.json|vite\.config\.ts|tsconfig[^/]*\.json|playwright\.storybook\.config\.ts)$/,
  /^app\/e2e\/storybook-[^/]+$/,
  /^scripts\/(storybook-stories|e2e-specs)\.mjs$/,
  /^pnpm-lock\.yaml$/,
];

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
 * @param {{ root: string }} options
 * @returns {Array<[number, string]> | "all"} [tier, story file as ./src/...], tier 1 first
 */
export function selectStories(changed, { root }) {
  if (changed.some((file) => runsAll.some((pattern) => pattern.test(file)))) return "all";
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
// Storybook or Vite config, the design package, the lockfile, a script.
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
 * @returns {boolean} true when the related tests are enough
 */
export function relatedRun(nameStatus) {
  for (const line of nameStatus) {
    const [status, file] = line.split("\t");
    if (!/^[AM]$/.test(status ?? "") || !file) return false;
    if (file === "app/src/test-setup.ts") return false;
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
    console.log(relatedRun(lines) ? "related" : "all");
    process.exit(0);
  }
  const indexPath = arg("--index");
  if (!indexPath) throw new Error("usage: storybook-stories.mjs --index <index.json> [--budget N]");
  const changed = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stories = selectStories(changed, { root });
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
    const { files, partial } = pickStories(stories, counts, Number(arg("--budget") ?? "250"));
    for (const file of files) console.log(file);
    if (partial) console.log("partial");
  }
}
