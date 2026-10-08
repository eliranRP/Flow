#!/usr/bin/env node
// FLOW-813: the e2e specs that a set of changed files reaches, from app/e2e/spec-sources.json.
// Usage: git diff --name-only <base> HEAD | node scripts/e2e-specs.mjs
// Prints one spec path per line, relative to app/ (e2e/x.spec.ts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const importPattern =
  /(?:import|export)\s([^'"]*?)from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const sourcePattern = /\.(ts|tsx|css)$/;
const notSourcePattern = /\.(test|stories)\.tsx?$/;

/** @param {string} root @param {string} from @param {string} spec */
function resolveImport(root, from, spec) {
  let base;
  if (spec === "@flow/shared") base = "packages/shared/src/index";
  else if (spec.startsWith("@flow/shared/")) base = `packages/shared/src/${spec.slice("@flow/shared/".length)}`;
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  return null;
}

/** The names a `{ a, type B as C }` clause takes, or null for a default or namespace import. */
function namedImports(clause) {
  const braces = /^\s*(?:type\s+)?\{([^}]*)\}\s*$/.exec(clause);
  if (!braces) return null;
  return braces[1]
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
    .filter(Boolean);
}

/**
 * A file of `export { ... } from "..."` lines only (the screens barrel): name -> source, else null.
 * An import of some names from it reaches only the files those names come from.
 */
function reExports(text) {
  const lines = text.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//"));
  const names = new Map();
  for (const line of lines) {
    const match = /^export\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];?\s*$/.exec(line.trim());
    if (!match) return null;
    for (const name of namedImports(`{${match[1]}}`) ?? []) names.set(name, match[2]);
  }
  return names.size > 0 ? names : null;
}

/** Every source under a folder (repo-relative, posix), without tests and stories. */
function folderSources(root, folder) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const rel = `${folder}${entry.name}`;
    if (entry.isDirectory()) out.push(...folderSources(root, `${rel}/`));
    else if (sourcePattern.test(entry.name) && !notSourcePattern.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * @param {{ root: string, map: any }} options
 * @returns {{ all: RegExp[], closures: Map<string, Set<string>> }}
 */
export function specClosures({ root, map }) {
  const all = map.all.map((pattern) => new RegExp(pattern));
  const texts = new Map();
  const read = (file) => {
    if (!texts.has(file)) texts.set(file, fs.readFileSync(path.join(root, file), "utf8"));
    return texts.get(file);
  };
  const closures = new Map();
  for (const [spec, entries] of Object.entries(map.specs)) {
    const start = [`app/e2e/${spec}`];
    for (const entry of entries) {
      if (entry.endsWith("/")) start.push(...folderSources(root, `app/src/${entry}`));
      else start.push(`app/src/${entry}`);
    }
    const seen = new Set();
    const stack = [...start];
    while (stack.length > 0) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      // A file that runs every spec (App.tsx, the screens barrel) is not followed.
      if (all.some((pattern) => pattern.test(file)) || !/\.(ts|tsx)$/.test(file)) continue;
      const text = read(file);
      for (const match of text.matchAll(importPattern)) {
        const resolved = resolveImport(root, file, match[2] ?? match[3] ?? match[4]);
        if (!resolved) continue;
        stack.push(resolved);
        const barrel = /\.tsx?$/.test(resolved) ? reExports(read(resolved)) : null;
        if (!barrel) continue;
        // A default or namespace import of a barrel reaches all of it.
        const names = (match[1] === undefined ? null : namedImports(match[1])) ?? [...barrel.keys()];
        for (const name of names) {
          const source = barrel.get(name);
          const target = source ? resolveImport(root, resolved, source) : null;
          if (target) stack.push(target);
        }
      }
    }
    closures.set(spec, seen);
  }
  return { all, closures };
}

/**
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, map: any }} options
 * @returns {string[]} spec file names
 */
export function selectSpecs(changed, { root, map }) {
  const { all, closures } = specClosures({ root, map });
  const runsAll = changed.some((file) => all.some((pattern) => pattern.test(file)));
  return [...closures.keys()]
    .filter((spec) => runsAll || changed.some((file) => closures.get(spec).has(file)))
    .sort();
}

export function readMap(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "app/e2e/spec-sources.json"), "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changed = fs
    .readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const spec of selectSpecs(changed, { root, map: readMap(root) })) console.log(`e2e/${spec}`);
}
