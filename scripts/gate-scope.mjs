#!/usr/bin/env node
// What the pre-push gate's lint and build parts must re-check for a branch's change.
// Usage: git diff --name-status <base> HEAD | node scripts/gate-scope.mjs --lint
//   Prints "all", or the files eslint must lint again, one per line (none when the change reaches
//   no file eslint reads).
// Usage: git diff --name-status <base> HEAD -- <app inputs> | node scripts/gate-scope.mjs --build
//   Prints "build" when the change can reach the built app, else "skip".
// Usage: git diff --name-only <base> HEAD | node scripts/gate-scope.mjs --sweep
//   Prints the no-op sweep routes the change reaches, one "e2e/<spec>\t<url>\t<why>" per line.
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
 * Each tracked file -> the tracked code files that import it.
 * @param {{ root: string, files?: string[] }} options files: the tracked files (default: git ls-files)
 * @returns {Map<string, Set<string>>}
 */
export function importGraph({ root, files }) {
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
  return importedBy;
}

/**
 * Every tracked file that imports one of `changed`, directly or through other files, plus the
 * changed files themselves.
 * @param {string[]} changed repo-relative paths
 * @param {{ root: string, files?: string[] }} options files: the tracked files (default: git ls-files)
 */
export function importers(changed, { root, files }) {
  const importedBy = importGraph({ root, files });
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

// The no-op control sweep (app/e2e/control-sweep.ts) opens each route of its specs and taps every
// control there. A route renders the app shell (what App.tsx and main.tsx import, outside the screens
// they load on a route) and its screen: a file a route loads lazily (App.tsx's and
// screen-loaders.ts's import() targets) or one of `sweeps.pages`, imported by App.tsx for its first
// paint. The /e2e/ routes draw their screens through dev-routes.tsx, with its fixtures.
const shellRoots = ["app/src/App.tsx", "app/src/main.tsx"];
const lazyLoaders = ["app/src/App.tsx", "app/src/screen-loaders.ts"];
const devRoutes = "app/src/dev-routes.tsx";
// Barrels and loaders that import every screen: a screen reaches them, but they draw nothing of it.
const screenIndexes = new Set(["app/src/screens/flow-screens.tsx", "app/src/screen-loaders.ts"]);
const dynamicImport = /import\(\s*["']([^"']+)["']\s*\)/g;
const staticImport = /^import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gms;
const declaration = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class|type|interface)\s+([A-Za-z_$][\w$]*)/;

/**
 * Which top-level declarations of a module use what it imports from `target` (only the names in
 * `only`, when given), directly or through its other declarations, or null when that can't be told
 * (a side-effect or unparsed import).
 * @param {Set<string>} exists @param {string} file @param {string} text @param {string} target
 * @param {Set<string> | null} only
 * @returns {Set<string> | null}
 */
function declarationsUsing(exists, file, text, target, only) {
  const locals = new Set();
  let imported = false;
  for (const match of text.matchAll(staticImport)) {
    if (resolveImport(exists, file, match[2]) !== target) continue;
    imported = true;
    const clause = match[1].replace(/\btype\s+/g, "");
    for (const part of clause.replace(/[{}]/g, ",").split(",")) {
      const [original, local = original] = part.trim().replace(/^\*\s*/, "").split(/\s+as\s+/).map((name) => name.trim());
      if (local && (!only || only.has(original))) locals.add(local);
    }
  }
  if (!imported || locals.size === 0) return null;
  const bodies = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const start = declaration.exec(line);
    if (start) {
      current = start[1];
      bodies.set(current, "");
    }
    if (current) bodies.set(current, `${bodies.get(current)}${line}\n`);
  }
  const using = new Set();
  const stack = [...locals];
  while (stack.length > 0) {
    const name = stack.pop();
    const word = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, "\\$")}([^\\w$]|$)`);
    for (const [declared, body] of bodies) {
      if (using.has(declared) || declared === name || !word.test(body)) continue;
      using.add(declared);
      stack.push(declared);
    }
  }
  return using;
}

/**
 * The names a barrel re-exports from `source` (`export { a, b } from "./source"`), or null when it
 * does more than re-export by name.
 * @param {Set<string>} exists @param {string} root @param {string} barrel @param {string} source
 */
function reExportedFrom(exists, root, barrel, source) {
  const names = new Set();
  for (const line of fs.readFileSync(path.join(root, barrel), "utf8").split("\n")) {
    const match = /^export\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];?\s*$/.exec(line.trim());
    if (!match) {
      if (line.trim() && !line.trim().startsWith("//") && !line.startsWith("import ")) return null;
      continue;
    }
    if (resolveImport(exists, barrel, match[2]) !== source) continue;
    for (const part of match[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * The sweep routes a change reaches, with the reason for each. A route is swept when a changed file
 * is, or is imported (at any depth) by, one of the route's files in `map.sweeps.routes`; every route
 * when the change matches `map.all`, changes the sweep, or reaches the app shell outside a screen;
 * every /e2e/ route when it reaches dev-routes.tsx outside a screen.
 * @param {string[]} changed repo-relative paths (git diff --name-only)
 * @param {{ root: string, files?: string[], map: any }} options map: app/e2e/spec-sources.json
 * @returns {{ spec: string, url: string, why: string }[]}
 */
export function sweepRoutes(changed, { root, files, map }) {
  const tracked = files ?? execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const exists = new Set(tracked);
  const routes = Object.entries(map.sweeps.routes).flatMap(([spec, urls]) =>
    Object.entries(urls).map(([url, entries]) => ({ spec, url, entries: entries.map((entry) => `app/src/${entry}`) })),
  );
  const every = (why) => routes.map(({ spec, url }) => ({ spec, url, why }));
  const all = map.all.map((pattern) => new RegExp(pattern));
  for (const file of changed) {
    if (all.some((pattern) => pattern.test(file))) return every(`${file} runs every spec`);
    if (file === "app/e2e/control-sweep.ts") return every(`${file} is the sweep`);
  }
  const pages = new Set(map.sweeps.pages.map((page) => `app/src/${page}`));
  for (const loader of lazyLoaders) {
    if (!exists.has(loader)) continue;
    for (const match of fs.readFileSync(path.join(root, loader), "utf8").matchAll(dynamicImport)) {
      const target = resolveImport(exists, loader, match[1]);
      if (target) pages.add(target);
    }
  }
  const importedBy = importGraph({ root, files: tracked });
  // The shell: what App.tsx and main.tsx import, all the way down, without entering a screen.
  const imports = new Map();
  for (const [target, sources] of importedBy) {
    for (const source of sources) {
      if (!imports.has(source)) imports.set(source, new Set());
      imports.get(source).add(target);
    }
  }
  const shell = new Set();
  const down = shellRoots.filter((file) => exists.has(file));
  while (down.length > 0) {
    const file = down.pop();
    if (shell.has(file) || pages.has(file)) continue;
    shell.add(file);
    for (const target of imports.get(file) ?? []) down.push(target);
  }
  // Each changed file's importers, all the way up. A screen's own importers count only when they
  // draw it: App.tsx, dev-routes.tsx and the screen indexes load it on its route instead.
  // dev-routes.tsx draws each /e2e/ route with one of its exports (a route's "dev-routes.tsx#Name"
  // entry): a file it imports reaches the exports that use it.
  const devText = exists.has(devRoutes) ? fs.readFileSync(path.join(root, devRoutes), "utf8") : "";
  const reached = new Map();
  for (const file of changed) {
    const seen = new Set();
    const stack = [{ file, fromPage: false, via: "", names: null }];
    while (stack.length > 0) {
      const { file: next, fromPage, via, names } = stack.pop();
      const key = `${next}\t${fromPage}\t${next === devRoutes ? `${via}\t${[...(names ?? [])].join()}` : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (shell.has(next) && !pages.has(next)) {
        if (fromPage && (shellRoots.includes(next) || screenIndexes.has(next))) continue;
        return every(`${file} reaches the app shell through ${next}`);
      }
      if (next === devRoutes) {
        if (fromPage) continue;
        const using = declarationsUsing(exists, devRoutes, devText, via, names);
        if (using === null) reached.set("e2e", `${file} reaches the e2e fixtures (${devRoutes})`);
        for (const name of using ?? []) {
          if (!reached.has(`${devRoutes}#${name}`)) reached.set(`${devRoutes}#${name}`, file);
        }
        continue;
      }
      if (!reached.has(next)) reached.set(next, file);
      const page = pages.has(next) || fromPage;
      // Through a re-export barrel, only the names it takes from the file below it.
      const barrel = screenIndexes.has(next) ? reExportedFrom(exists, root, next, via) : null;
      for (const importer of importedBy.get(next) ?? []) {
        if (page && (screenIndexes.has(importer) || shellRoots.includes(importer))) continue;
        stack.push({ file: importer, fromPage: page, via: next, names: barrel });
      }
    }
  }
  const out = [];
  for (const { spec, url, entries } of routes) {
    if (changed.includes(`app/e2e/${spec}`)) {
      out.push({ spec, url, why: `app/e2e/${spec} changed` });
      continue;
    }
    const hit = entries.find((entry) => reached.has(entry));
    if (hit) out.push({ spec, url, why: `${reached.get(hit)} reaches ${hit}` });
    else if (url.startsWith("/e2e/") && reached.has("e2e")) out.push({ spec, url, why: reached.get("e2e") });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const lines = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
  if (process.argv[2] === "--lint") {
    const scope = lintScope(lines, { root });
    process.stdout.write(scope === "all" ? "all\n" : scope.map((file) => `${file}\n`).join(""));
  } else if (process.argv[2] === "--build") {
    process.stdout.write(reachesApp(lines) ? "build\n" : "skip\n");
  } else if (process.argv[2] === "--sweep") {
    const map = JSON.parse(fs.readFileSync(path.join(root, "app/e2e/spec-sources.json"), "utf8"));
    for (const { spec, url, why } of sweepRoutes(lines, { root, map })) process.stdout.write(`e2e/${spec}\t${url}\t${why}\n`);
  } else {
    process.stderr.write("Usage: node scripts/gate-scope.mjs --lint | --build (git diff --name-status on stdin) | --sweep (git diff --name-only)\n");
    process.exit(2);
  }
}
