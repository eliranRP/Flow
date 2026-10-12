#!/usr/bin/env node
/**
 * FLOW-363: no raw design value in the app's CSS. Colours, type sizes and weights, durations,
 * easings, radii and spacing come from the tokens in design/system/implementation-tokens.css.
 * Each app/src CSS file has a baseline count per rule (scripts/css-tokens-baseline.json): a count
 * above it fails, and a count below it fails too, asking for the baseline to be lowered in the
 * same PR that removes the raw values. app/src/styles/app.css is skipped: it maps the tokens into
 * Tailwind's @theme and holds the token aliases.
 *
 * Usage: node scripts/check-css-tokens.mjs            (exits 1 on any count that differs)
 *        node scripts/check-css-tokens.mjs --write-baseline
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_FILE = "scripts/css-tokens-baseline.json";
export const SKIPPED_FILES = new Set(["app/src/styles/app.css"]);

const COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const NUMERIC_WEIGHT = /^\d+$/;
const DURATION = /(^|[\s,(])\d+(\.\d+)?(ms|s)\b/;
const SPACING_PROPERTY = /^(margin|padding)(-|$)|^(row-|column-)?gap$|^inset(-|$)|^(top|right|bottom|left)$/;
const RADIUS_PROPERTY = /^border(-[a-z]+)*-radius$/;
const DURATION_PROPERTY = /^(transition|animation)(-duration|-delay)?$|-(duration|delay)$/;

/** The CSS with its comments blanked out (line breaks kept, so line numbers still match). */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** The raw value problems one declaration has. */
function problemsOf(property, value) {
  const found = [];
  const v = value.trim();
  const usesToken = /var\(--/.test(v);
  if (COLOR_VALUE.test(v)) found.push("color");
  if ((property === "font-size" || property === "line-height") && !usesToken && !/^(inherit|0|1)$/.test(v)) {
    found.push(property);
  }
  if (property === "font-weight" && NUMERIC_WEIGHT.test(v)) found.push("font-weight");
  if (/cubic-bezier\(/.test(v)) found.push("easing");
  if (DURATION_PROPERTY.test(property) && DURATION.test(v)) found.push("duration");
  if (RADIUS_PROPERTY.test(property) && !radiusIsToken(v)) found.push("radius");
  if (SPACING_PROPERTY.test(property) && rawPixels(v).length > 0) {
    found.push("spacing");
  }
  return found;
}

/** Each word of a radius is a token, 0, 50% or inherit. */
function radiusIsToken(value) {
  return value.split(/\s+/).every((word) => /^var\(--radius-[\w-]+\)$/.test(word) || /^(0|50%|inherit)$/.test(word));
}

/** The raw px lengths in a spacing value, leaving out 0, 1px and -1px. */
function rawPixels(value) {
  return [...value.matchAll(/-?\d+(\.\d+)?px\b/g)].map((match) => match[0]).filter((px) => px !== "0" && px !== "1px" && px !== "-1px");
}

/**
 * @param {string} css
 * @returns {Array<{ rule: string, line: number, property: string, value: string }>}
 */
export function findViolations(css) {
  const text = stripComments(css);
  const violations = [];
  for (const match of text.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const property = match[1].toLowerCase();
    if (property.startsWith("--")) continue;
    const value = match[2].trim();
    const line = text.slice(0, match.index).split("\n").length;
    for (const rule of problemsOf(property, value)) {
      violations.push({ rule, line, property, value });
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

/** @returns {Record<string, number>} the number of violations per rule */
export function countRules(violations) {
  const counts = {};
  for (const violation of violations) counts[violation.rule] = (counts[violation.rule] ?? 0) + 1;
  return counts;
}

/**
 * @param {Record<string, Record<string, number>>} current  file -> rule -> count
 * @param {Record<string, Record<string, number>>} baseline
 * @returns {{ above: Array<{file:string,rule:string,count:number,baseline:number}>, below: Array<{file:string,rule:string,count:number,baseline:number}> }}
 */
export function compareCounts(current, baseline) {
  const above = [];
  const below = [];
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    const rules = new Set([...Object.keys(current[file] ?? {}), ...Object.keys(baseline[file] ?? {})]);
    for (const rule of [...rules].sort()) {
      const count = current[file]?.[rule] ?? 0;
      const base = baseline[file]?.[rule] ?? 0;
      if (count > base) above.push({ file, rule, count, baseline: base });
      if (count < base) below.push({ file, rule, count, baseline: base });
    }
  }
  return { above, below };
}

function appCssFiles() {
  return execFileSync("git", ["ls-files", "app/src"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => file.endsWith(".css") && !SKIPPED_FILES.has(file));
}

function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const current = {};
  const details = {};
  for (const file of appCssFiles()) {
    const violations = findViolations(readFileSync(path.join(root, file), "utf8"));
    if (violations.length === 0) continue;
    current[file] = countRules(violations);
    details[file] = violations;
  }
  if (writeBaseline) {
    const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`check-css-tokens: wrote ${BASELINE_FILE} (${String(Object.keys(sorted).length)} file(s)).`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
  const { above, below } = compareCounts(current, baseline);
  for (const item of above) {
    const lines = (details[item.file] ?? []).filter((violation) => violation.rule === item.rule);
    console.error(`${item.file}: ${item.rule} ${String(item.count)} raw value(s), baseline ${String(item.baseline)}`);
    for (const violation of lines) console.error(`  line ${String(violation.line)}: ${violation.property}: ${violation.value}`);
  }
  for (const item of below) {
    console.error(`${item.file}: ${item.rule} ${String(item.count)} raw value(s), baseline ${String(item.baseline)}: lower the baseline (node scripts/check-css-tokens.mjs --write-baseline) in this PR.`);
  }
  if (above.length > 0 || below.length > 0) {
    console.error(`\ncheck-css-tokens: ${String(above.length + below.length)} count(s) differ from ${BASELINE_FILE}. Use a token (design/system/implementation-tokens.css) for a new value.`);
    return 1;
  }
  console.log("check-css-tokens: every app CSS file matches its raw-value baseline.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
