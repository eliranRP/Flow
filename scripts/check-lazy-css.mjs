#!/usr/bin/env node
/**
 * FLOW-974: the rules only on-demand screens use live in app/src/ui/lazy.css, out of Home's first
 * load. Vite loads a chunk's CSS before the chunk's module runs, so every module the app loads with
 * a dynamic import() and that draws anything (a .tsx file) imports lazy.css itself. Then no screen,
 * sheet or card can render before its styles arrive.
 * Usage: node scripts/check-lazy-css.mjs   (prints each module that misses it; exits 1 on any)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Loaded with import() and also statically by Home's first load, so they must not pull lazy.css in. */
export const inHomeEntry = new Set(["app/src/ui/sheet.tsx"]);

/**
 * @param {string} from  repo-relative path of the importing file
 * @param {string} source  its text
 * @returns {string[]} repo-relative paths of the .tsx modules it loads with import()
 */
export function dynamicTsxTargets(from, source) {
  const out = [];
  for (const match of source.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const base = path.posix.join(path.posix.dirname(from), match[1]);
    if (/\.css$/.test(base)) continue;
    const tsx = base.endsWith(".tsx") ? base : `${base}.tsx`;
    if (existsSync(path.join(root, tsx))) out.push(tsx);
    else if (existsSync(path.join(root, base, "index.tsx"))) out.push(`${base}/index.tsx`);
  }
  return out;
}

/** @param {string} source @returns {boolean} whether it imports ui/lazy.css */
export function importsLazyCss(source) {
  return /^import\s+["'][./]*(?:ui\/)?lazy\.css["'];/m.test(source);
}

function main() {
  const files = execFileSync("git", ["ls-files", "app/src"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|stories)\.tsx?$/.test(file) && !file.includes("/dev/") && !/test-(setup|backend|utils)/.test(file));
  const targets = new Set();
  for (const file of files) {
    for (const target of dynamicTsxTargets(file, readFileSync(path.join(root, file), "utf8"))) {
      // Dev-only routes render the screens, which import it themselves.
      if (!inHomeEntry.has(target) && !target.includes("/dev/")) targets.add(target);
    }
  }
  const missing = [...targets].sort().filter((file) => !importsLazyCss(readFileSync(path.join(root, file), "utf8")));
  for (const file of missing) console.error(`${file}: loaded with import() but does not import ui/lazy.css`);
  if (missing.length > 0) {
    console.error(`\ncheck-lazy-css: ${String(missing.length)} on-demand module(s) could render before their styles load. Add \`import "…/ui/lazy.css";\` (FLOW-974).`);
    process.exit(1);
  }
  console.log(`check-lazy-css: all ${String(targets.size)} on-demand modules import ui/lazy.css.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
