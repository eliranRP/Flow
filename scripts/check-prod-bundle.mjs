/**
 * The built client must not include fixture modules or the golden answer key.
 * Unit tests and Storybook may. `pnpm check:bundle` reads the Rollup module
 * graph written by the app build, then scans dist for the golden values.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const goldenValues = ["37700", "134520", "2389917160"];
const fixtureSentence =
  "שיפוץ דירה + לובי בבניין ברחוב הרצל 12, רמת גן. הלקוח העיקרי יזמות הגליל; ד.ל. נכסים (חברת הניהול) הזמינה תוספות בלובי.";

const modulePatterns = [
  /[/\\]fixtures[/\\]/,
  /expected-pnl/,
  /\.stories\.(tsx?|jsx?|mdx)/,
  /[/\\]demo[/\\]/,
  /[/\\]demo[^/\\]*\.(tsx?|jsx?|mjs)/,
  /@flow[/\\]shared[/\\]testing/,
  /[/\\]testing\.ts$/,
];

/**
 * @param {{ modules: string[], files: { name: string, body: string }[] }} input
 * @returns {string[]}
 */
export function violations(input) {
  const found = [];
  for (const id of input.modules) {
    if (modulePatterns.some((pattern) => pattern.test(id))) {
      found.push(`module graph includes ${id}`);
    }
  }
  for (const file of input.files) {
    if (file.body.includes("demo-data") || file.body.includes("expected-pnl") || file.body.includes(fixtureSentence)) {
      found.push(`${file.name} contains a fixture marker`);
    }
    for (const value of goldenValues) {
      if (file.body.includes(value)) found.push(`${file.name} contains golden value ${value}`);
    }
  }
  return found;
}

function scanDist(dist) {
  /** @type {{ name: string, body: string }[]} */
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|css|html|webmanifest|json)$/.test(name)) continue;
      if (name === "bundle-graph.json") continue;
      files.push({ name: path.relative(root, full), body: readFileSync(full, "utf8") });
    }
  };
  if (existsSync(dist)) walk(dist);
  return files;
}

export function checkProductionBundle() {
  const dist = path.join(root, "app/dist");
  const graphPath = path.join(dist, "bundle-graph.json");
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(dist)) problems.push("app/dist is missing. Run pnpm build before this check.");
  if (!existsSync(graphPath)) {
    problems.push("app/dist/bundle-graph.json is missing. The production build must record its module graph.");
    return problems;
  }
  const modules = JSON.parse(readFileSync(graphPath, "utf8"));
  if (!Array.isArray(modules)) {
    problems.push("bundle-graph.json is not a list of module ids");
    return problems;
  }
  return violations({ modules, files: scanDist(dist) });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const bad = checkProductionBundle();
  if (bad.length > 0) {
    console.error(bad.join("\n"));
    process.exit(1);
  }
  console.log("production graph and dist have no fixtures or golden values");
}
