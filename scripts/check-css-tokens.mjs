#!/usr/bin/env node
/**
 * FLOW-363: no raw design value in the app's CSS. Colours, type sizes and weights, durations,
 * easings, radii and spacing come from the tokens in design/system/implementation-tokens.css.
 * Each app/src CSS file has a baseline count per rule (scripts/css-tokens-baseline.json): a count
 * above it fails, and a count below it fails too, asking for the baseline to be lowered in the
 * same PR that removes the raw values. In app/src/styles/app.css only the :root and @theme blocks
 * are skipped (they map the tokens into Tailwind and hold the aliases); its other rules are checked.
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
export const TOKEN_BLOCK_FILES = new Set(["app/src/styles/app.css"]);

const COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
/** CSS named colours (transparent, currentColor and inherit are allowed, so they are not here). */
const NAMED_COLOR = new RegExp(
  `(?<![-\\w#.])(${[
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown",
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod",
    "darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue",
    "darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen",
    "fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred",
    "indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray",
    "lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen",
    "linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred",
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid",
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple",
    "red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue",
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat",
    "white whitesmoke yellow yellowgreen",
  ]
    .join(" ")
    .split(" ")
    .join("|")})(?![-\\w(])`,
  "i",
);
/** Properties whose value can hold a colour (a named colour elsewhere, e.g. in an animation name, is not one). */
const COLOR_PROPERTY = /(^|-)(color|background|border|outline|shadow|fill|stroke|decoration)(-|$)/;
const NUMERIC_WEIGHT = /^\d+$/;
/** A non-zero duration: 0s and 0ms (a `visibility 0s` step) are not design values. */
const DURATION = /(^|[\s,(])(?!0+(\.0+)?m?s\b)\d*\.?\d+(ms|s)\b/;
const SPACING_PROPERTY = /^(margin|padding)(-|$)|^(row-|column-)?gap$|^inset(-|$)|^(top|right|bottom|left)$/;
const RADIUS_PROPERTY = /^border(-[a-z]+)*-radius$/;
const DURATION_PROPERTY = /^(transition|animation)(-duration|-delay)?$|-(duration|delay)$/;

/** The CSS with its comments blanked out (line breaks kept, so line numbers still match). */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** The CSS with its top-level `:root { }` and `@theme ... { }` blocks blanked (line breaks kept). */
export function stripTokenBlocks(css) {
  const text = stripComments(css);
  let out = "";
  let index = 0;
  for (const match of text.matchAll(/(^|[}\s])(:root|@theme[^{]*)\s*\{/g)) {
    const start = match.index + match[1].length;
    if (start < index) continue;
    let depth = 0;
    let end = start;
    for (let i = text.indexOf("{", start); i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      if (text[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
    out += text.slice(index, start) + text.slice(start, end).replace(/[^\n]/g, " ");
    index = end;
  }
  return out + text.slice(index);
}

/** The raw value problems one declaration has. */
function problemsOf(property, value) {
  const found = [];
  const v = value.trim();
  const usesToken = /var\(--/.test(v);
  if (COLOR_VALUE.test(v) || (COLOR_PROPERTY.test(property) && NAMED_COLOR.test(v.replace(/var\([^)]*\)/g, "")))) found.push("color");
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

/** The raw px lengths in a spacing value, leaving out 0px (an env() or var() fallback), 1px and -1px. */
function rawPixels(value) {
  return [...value.matchAll(/-?\d*\.?\d+px\b/g)]
    .map((match) => match[0])
    .filter((px) => !/^-?0*\.?0+px$/.test(px) && px !== "1px" && px !== "-1px");
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
    .filter((file) => file.endsWith(".css"));
}

function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const current = {};
  const details = {};
  for (const file of appCssFiles()) {
    const css = readFileSync(path.join(root, file), "utf8");
    const violations = findViolations(TOKEN_BLOCK_FILES.has(file) ? stripTokenBlocks(css) : css);
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
