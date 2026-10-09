#!/usr/bin/env node
// The story files a set of changed files reaches, for the pre-push every-story check.
// Usage: git diff --name-only <base> HEAD | node scripts/storybook-stories.mjs
// Prints "<tier> <story file>" per line, the file as Storybook's index names it (./src/x.stories.tsx),
// or "all" when a change reaches every story (the Storybook config, the lockfile, the smoke itself).
// Tier 1: a changed story file. Tier 2: a story that imports a changed file. Tier 3: a story whose
// imports reach one further down. The check takes whole tiers while they fit its story budget.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changed = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stories = selectStories(changed, { root });
  if (stories === "all") console.log("all");
  else for (const [tier, story] of stories) console.log(`${String(tier)} ${story}`);
}
