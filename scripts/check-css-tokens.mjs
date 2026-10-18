#!/usr/bin/env node
/**
 * FLOW-363: no raw design value in the app's CSS. Colours, type sizes and weights, durations,
 * easings, radii and spacing come from the tokens in design/system/implementation-tokens.css; a
 * value the board measures that has no token yet is added there as a named token. Any raw value
 * fails. In app/src/styles/app.css only the :root and @theme blocks are skipped (they map the
 * tokens into Tailwind and hold the aliases); its other rules are checked.
 *
 * Usage: node scripts/check-css-tokens.mjs            (exits 1 on any raw value)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function appCssFiles() {
  return execFileSync("git", ["ls-files", "app/src"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => file.endsWith(".css"));
}

function main() {
  let total = 0;
  for (const file of appCssFiles()) {
    const css = readFileSync(path.join(root, file), "utf8");
    const violations = findViolations(TOKEN_BLOCK_FILES.has(file) ? stripTokenBlocks(css) : css);
    for (const violation of violations) {
      console.error(`${file}:${String(violation.line)}: ${violation.rule}: ${violation.property}: ${violation.value}`);
    }
    total += violations.length;
  }
  if (total > 0) {
    console.error(`\ncheck-css-tokens: ${String(total)} raw value(s). Use a token, or add a named one to design/system/implementation-tokens.css.`);
    return 1;
  }
  console.log("check-css-tokens: no raw design value in app CSS.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
