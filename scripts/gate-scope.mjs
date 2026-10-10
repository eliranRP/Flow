#!/usr/bin/env node
// What the pre-push gate's lint and build parts must re-check for a branch's change.
// Usage: git diff --name-status <base> HEAD | node scripts/gate-scope.mjs --lint
//   Prints "all", or the files eslint must lint again, one per line (none when the change reaches
//   no file eslint reads).
// Usage: git diff --name-status <base> HEAD -- <app inputs> | node scripts/gate-scope.mjs --build
//   Prints "build" when the change can reach the built app, else "skip".
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The lint rules are type-aware, so a file's result depends on its own text and on the types of
// everything it imports, all the way down. These change what every file sees: the eslint config,
// a tsconfig, a manifest or the lockfile (plugin, rule and type versions), and a .d.ts (globals).
const lintsAll = /(^|\/)(eslint\.config\.[cm]?js|tsconfig[^/]*\.json|package\.json)$|^pnpm-(lock|workspace)\.yaml$|\.d\.[cm]?ts$/;
const code = /\.([cm]?[jt]s|[jt]sx)$/;
// Imports and re-exports, dynamic imports, and bare side-effect imports.
const importPattern =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

/** The repo file an import names: a relative path, or @flow/shared (its exports map). */
function resolveImport(exists, from, spec) {
  let base;
  if (spec === "@flow/shared") base = "packages/shared/src/index";
  else if (spec.startsWith("@flow/shared/")) base = `packages/shared/src/${spec.slice("@flow/shared/".length)}`;
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  const stem = base.replace(/\.[cm]?js$/, "");
  for (const candidate of [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (exists.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every tracked file that imports one of `changed`, directly or through other files, plus the
 * changed files themselves.
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, files?: string[] }} options files: the tracked files (default: git ls-files)
 */
export function importers(changed, { root, files }) {
  const tracked = files ?? execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const exists = new Set(tracked);
  const importedBy = new Map();
  for (const file of tracked) {
    if (!code.test(file) || !fs.existsSync(path.join(root, file))) continue;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(importPattern)) {
      const target = resolveImport(exists, file, match[1] ?? match[2] ?? match[3]);
      if (!target) continue;
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target).add(file);
    }
  }
  const seen = new Set();
  const stack = [...changed];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const importer of importedBy.get(file) ?? []) stack.push(importer);
  }
  return seen;
}

/**
 * "all", or the code files eslint must lint again for these `git diff --name-status` lines.
 * A delete, rename or copy lints all: the files that imported the old path are gone from the graph.
 * @param {string[]} nameStatus
 * @param {{ root: string, files?: string[] }} options
 * @returns {"all" | string[]}
 */
export function lintScope(nameStatus, options) {
  const changed = [];
  for (const line of nameStatus) {
    const [status, file] = line.split("\t");
    if (!file) continue;
    if (!/^[AM]$/.test(status ?? "") || lintsAll.test(file)) return "all";
    // CSS, Markdown and the like type as nothing an importer can see (vite's client types).
    if (code.test(file) || file.endsWith(".json")) changed.push(file);
  }
  return [...importers(changed, options)].filter((file) => code.test(file)).sort();
}

// What the built app never reads: tests, stories, e2e specs, the test and Storybook setups, the
// Playwright and vitest configs, the perf scripts, the migrations (only tests glob them) and the
// scripts' own tests. Stories-support files and everything else count as build inputs.
const buildUnread =
  /^app\/src\/(.*\/)?[^/]+\.(test|stories)\.tsx?$|^app\/src\/(.*\/)?test-[^/]+\.ts$|^app\/e2e\/|^app\/\.storybook\/|^app\/perf\/|^app\/playwright[^/]*\.config\.ts$|^app\/vitest\.config\.ts$|^supabase\/migrations\/|^scripts\/[^/]+\.test\.mjs$/;

/**
 * Whether `git diff --name-status` lines of the app inputs can change the built app. Every input
 * but buildUnread (and every delete or rename) can.
 * @param {string[]} nameStatus
 */
export function reachesApp(nameStatus) {
  return nameStatus.some((line) => {
    const [status, file] = line.split("\t");
    if (!file) return false;
    return !/^[AM]$/.test(status ?? "") || !buildUnread.test(file);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const lines = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
  if (process.argv[2] === "--lint") {
    const scope = lintScope(lines, { root });
    process.stdout.write(scope === "all" ? "all\n" : scope.map((file) => `${file}\n`).join(""));
  } else if (process.argv[2] === "--build") {
    process.stdout.write(reachesApp(lines) ? "build\n" : "skip\n");
  } else {
    process.stderr.write("Usage: node scripts/gate-scope.mjs --lint | --build (git diff --name-status on stdin)\n");
    process.exit(2);
  }
}
