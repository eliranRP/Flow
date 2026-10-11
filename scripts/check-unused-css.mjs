#!/usr/bin/env node
/**
 * FLOW-822: every class an app stylesheet styles is one the app, a test, a story or an e2e spec
 * names. Unlike unused JavaScript, which the build drops, every CSS rule ships in Home's first load.
 * A class built at runtime from a template (`ui-chip-${kind}`) counts for every class with that prefix.
 * Classes a library sets (vaul's drawer) are listed below.
 * Usage: node scripts/check-unused-css.mjs   (prints each unused class; exits 1 on any)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Classes a dependency puts on the page. */
export const libraryClasses = new Set(["vaul-dragging"]);

/** @param {string} css @returns {string[]} the class names its selectors use */
export function cssClasses(css) {
  const names = new Set();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^{}]*\}/g, "{}");
  for (const match of text.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) names.add(match[1]);
  return [...names];
}

/**
 * @param {string[]} classes
 * @param {string} source  the app's TypeScript, HTML and spec text, joined
 * @returns {string[]} the classes nothing names or builds
 */
export function unusedClasses(classes, source) {
  const prefixes = [...source.matchAll(/(?:^|[\s`"'])([a-z][\w-]*-)\$\{/g)].map((match) => match[1]);
  return classes.filter((name) => {
    if (libraryClasses.has(name)) return false;
    if (prefixes.some((prefix) => name.startsWith(prefix))) return false;
    return !new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(source);
  });
}

function main() {
  const list = (args) => execFileSync("git", ["ls-files", ...args], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const source = list(["app/src", "app/e2e", "app/.storybook", "app/index.html"])
    .filter((file) => /\.(tsx?|html)$/.test(file)).map(read).join("\n");
  const problems = [];
  for (const file of list(["app/src/*.css"])) {
    for (const name of unusedClasses(cssClasses(read(file)), source)) problems.push(`${file}: .${name}`);
  }
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`\ncheck-unused-css: ${String(problems.length)} class(es) no app code, test, story or spec names. Delete their rules (CONTRIBUTING, "Remove what your change leaves unused").`);
    process.exit(1);
  }
  console.log("check-unused-css: every app CSS class is named by the app, a test, a story or a spec.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
