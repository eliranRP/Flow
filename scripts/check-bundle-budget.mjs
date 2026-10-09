/**
 * FLOW-804: the size budget of the hosted build. Limits live in scripts/bundle-budget.json.
 *
 * - Home entry: the gzip size of the JavaScript and CSS that index.html loads before Home shows
 *   (its module scripts, module preloads and stylesheets).
 * - Total: the gzip size of every JavaScript file in the build.
 *
 * Usage: node scripts/check-bundle-budget.mjs [dist]   (default app/dist)
 * Exit codes: 0 within budget, 1 over a limit, 2 no build to read.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {Buffer | string} data */
export function gzipBytes(data) {
  return gzipSync(data, { level: 9 }).length;
}

/**
 * The same-origin files index.html loads up front, as paths relative to dist.
 * @param {string} html
 * @returns {string[]}
 */
export function entryFiles(html) {
  const files = new Set();
  const tags = html.match(/<(script|link)\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    const isScript = tag.startsWith("<script");
    const rel = /\brel="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (isScript && !/\btype="module"/.test(tag)) continue;
    if (!isScript && rel !== "stylesheet" && rel !== "modulepreload") continue;
    const ref = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (!ref || /^(https?:)?\/\//.test(ref)) continue;
    if (!/\.(js|css)$/.test(ref)) continue;
    files.add(ref.replace(/^\//, ""));
  }
  return [...files];
}

/**
 * @param {string} dist
 * @returns {{ entry: { file: string, gzip: number }[], entryGzip: number, totalJsGzip: number }}
 */
export function measure(dist) {
  const html = readFileSync(path.join(dist, "index.html"), "utf8");
  const entry = entryFiles(html).map((file) => ({ file, gzip: gzipBytes(readFileSync(path.join(dist, file))) }));
  const assets = path.join(dist, "assets");
  const js = existsSync(assets) ? readdirSync(assets).filter((name) => name.endsWith(".js")) : [];
  const totalJsGzip = js.reduce((sum, name) => sum + gzipBytes(readFileSync(path.join(assets, name))), 0);
  return { entry, entryGzip: entry.reduce((sum, item) => sum + item.gzip, 0), totalJsGzip };
}

/**
 * @param {{ entryGzip: number, totalJsGzip: number }} sizes
 * @param {{ homeEntryGzipKB: number, totalJsGzipKB: number }} budget
 * @returns {string[]} one line per limit passed
 */
export function overBudget(sizes, budget) {
  const over = [];
  const kb = (bytes) => (bytes / 1024).toFixed(1);
  if (sizes.entryGzip > budget.homeEntryGzipKB * 1024) {
    over.push(`Home entry is ${kb(sizes.entryGzip)} KB gzip, over its ${budget.homeEntryGzipKB} KB budget.`);
  }
  if (sizes.totalJsGzip > budget.totalJsGzipKB * 1024) {
    over.push(`All JavaScript is ${kb(sizes.totalJsGzip)} KB gzip, over its ${budget.totalJsGzipKB} KB budget.`);
  }
  return over;
}

function main() {
  const dist = path.resolve(process.argv[2] ?? path.join(root, "app/dist"));
  if (!existsSync(path.join(dist, "index.html"))) {
    console.error(`check-bundle-budget: no build at ${dist}. Run pnpm build first.`);
    process.exit(2);
  }
  const budget = JSON.parse(readFileSync(path.join(root, "scripts/bundle-budget.json"), "utf8"));
  const sizes = measure(dist);
  for (const item of sizes.entry) console.log(`entry ${item.file} ${(item.gzip / 1024).toFixed(1)} KB gzip`);
  console.log(
    `Home entry ${(sizes.entryGzip / 1024).toFixed(1)} / ${budget.homeEntryGzipKB} KB gzip; ` +
      `all JavaScript ${(sizes.totalJsGzip / 1024).toFixed(1)} / ${budget.totalJsGzipKB} KB gzip.`,
  );
  const over = overBudget(sizes, budget);
  if (over.length > 0) {
    for (const line of over) console.error(line);
    console.error("Load the new code on demand, or raise the limit in scripts/bundle-budget.json with the reason (FLOW-804).");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
