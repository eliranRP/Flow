#!/usr/bin/env node
// FLOW-813: the e2e specs that a set of changed files reaches, from app/e2e/spec-sources.json.
// Usage: git diff --name-only <base> HEAD | node scripts/e2e-specs.mjs [--routes | --perf]
// Prints one spec path per line, relative to app/ (e2e/x.spec.ts). --routes prints the specs that open
// a route a changed screen serves (the gate runs them first); --perf the page-speed specs
// (app/perf) whose page the change reaches.
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
 * Follows relative imports, the screens barrel by name, and @flow/shared from the start files.
 * A file `stop` matches is kept but not followed.
 * @param {string} root
 * @returns {(start: string[], stop?: (file: string) => boolean) => Set<string>}
 */
export function importWalker(root) {
  const texts = new Map();
  const read = (file) => {
    if (!texts.has(file)) texts.set(file, fs.readFileSync(path.join(root, file), "utf8"));
    return texts.get(file);
  };
  return (start, stop = () => false) => {
    const seen = new Set();
    const stack = [...start];
    while (stack.length > 0) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      if (!/\.(ts|tsx)$/.test(file) || stop(file)) continue;
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
    return seen;
  };
}

/**
 * @param {{ root: string, map: any }} options
 * @returns {{ all: RegExp[], closures: Map<string, Set<string>>, app: Set<string> }}
 */
export function specClosures({ root, map }) {
  const all = map.all.map((pattern) => new RegExp(pattern));
  const walker = importWalker(root);
  // A spec does not follow a file that runs every spec (App.tsx, the screens barrel).
  const walk = (start, followAll) => walker(start, (file) => !followAll && all.some((pattern) => pattern.test(file)));
  const closures = new Map();
  for (const [spec, entries] of Object.entries(map.specs)) {
    const start = [`app/e2e/${spec}`];
    for (const entry of entries) {
      if (entry.endsWith("/")) start.push(...folderSources(root, `app/src/${entry}`));
      else start.push(`app/src/${entry}`);
    }
    closures.set(spec, walk(start, false));
  }
  return { all, closures, app: walk(["app/src/main.tsx"], true) };
}

/**
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, map: any }} options
 * @returns {string[]} spec file names
 */
export function selectSpecs(changed, { root, map }) {
  const { all, closures, app } = specClosures({ root, map });
  const reached = new Set([...closures.values()].flatMap((closure) => [...closure]));
  // A source only App.tsx reaches (the session providers, the keyboard inset) is on every page.
  const runsAll = changed.some(
    (file) => all.some((pattern) => pattern.test(file)) || (app.has(file) && !reached.has(file)),
  );
  return [...closures.keys()]
    .filter((spec) => runsAll || changed.some((file) => closures.get(spec).has(file)))
    .sort();
}

/**
 * The specs that open a route a changed screen serves: the screen is an entry of that route in
 * `map.sweeps.routes`, and the spec names the route's path (/projects/, /e2e/project-detail) in a
 * string. The selection reaches far more specs through shared imports; the gate runs these first, so
 * its cap keeps the specs of the changed screen (#504 changed the project page and its cap left out
 * the three specs that open it). The sweep specs pick their own routes (gate-scope.mjs --sweep).
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, map: any }} options
 * @returns {string[]} spec file names
 */
export function routeSpecs(changed, { root, map }) {
  const prefixes = new Set();
  for (const urls of Object.values(map.sweeps.routes)) {
    for (const [url, entries] of Object.entries(urls)) {
      if (!entries.some((entry) => changed.includes(`app/src/${entry.split("#")[0]}`))) continue;
      const parts = url.split("?")[0].split("/").filter(Boolean);
      // /e2e/<page> is one page; elsewhere the first segment names it and the rest is an id.
      if (parts.length === 0) continue;
      prefixes.add(parts[0] === "e2e" ? `/${parts.slice(0, 2).join("/")}` : parts.length > 1 ? `/${parts[0]}/` : `/${parts[0]}`);
    }
  }
  if (prefixes.size === 0) return [];
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [...prefixes].map((prefix) => new RegExp(`["'\`]${escape(prefix)}${prefix.endsWith("/") ? "" : "(?![\\w-])"}`));
  return Object.keys(map.specs)
    .filter((spec) => !spec.startsWith("controls-sweep-"))
    .filter((spec) => {
      const text = fs.readFileSync(path.join(root, "app/e2e", spec), "utf8");
      return patterns.some((pattern) => pattern.test(text));
    })
    .sort();
}

/**
 * The page-speed specs (app/perf, `map.perf`) whose page the change reaches, the same way a spec is
 * reached: its entries, the spec and what they import; a change matching `map.all` runs them all.
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, map: any }} options
 * @returns {string[]} spec file names
 */
export function perfSpecs(changed, { root, map }) {
  const all = map.all.map((pattern) => new RegExp(pattern));
  if (changed.some((file) => all.some((pattern) => pattern.test(file)) || file.startsWith("app/perf/") || file === "app/playwright.perf.config.ts")) {
    return Object.keys(map.perf).sort();
  }
  const walker = importWalker(root);
  return Object.entries(map.perf)
    .filter(([spec, entries]) => {
      const closure = walker([`app/perf/${spec}`, ...entries.map((entry) => `app/src/${entry}`)], (file) => all.some((pattern) => pattern.test(file)));
      return changed.some((file) => closure.has(file));
    })
    .map(([spec]) => spec)
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
  const map = readMap(root);
  if (process.argv[2] === "--routes") for (const spec of routeSpecs(changed, { root, map })) console.log(`e2e/${spec}`);
  else if (process.argv[2] === "--perf") for (const spec of perfSpecs(changed, { root, map })) console.log(`perf/${spec}`);
  else for (const spec of selectSpecs(changed, { root, map })) console.log(`e2e/${spec}`);
}
