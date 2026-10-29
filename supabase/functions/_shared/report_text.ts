// FLOW-162: right-to-left text for the report PDF. A PDF draws glyphs left to right, so a Hebrew line is laid
// out here in visual order: the line splits into runs of Hebrew and of left-to-right text (Latin, digits and the
// money signs), the runs go from right to left, a Hebrew run's letters are reversed (brackets mirrored), and a
// left-to-right run keeps its order ("$29,000", "Cedar St", "01/01/2026"). Neutral characters between two
// left-to-right runs join them; any other neutral takes the line's right-to-left direction.

export type Script = "hebrew" | "latin";
/** One piece to draw, in visual order (left to right), with the subset that holds its glyphs. */
export type Segment = { text: string; script: Script };

type Kind = "R" | "L" | "E" | "N";

const HEBREW = /[֐-׿יִ-ﭏ]/;
const STRONG_L = /[A-Za-z0-9À-ɏ$€£₪%]/;
// Glyphs the Hebrew subset holds besides the letters (fontsource's unicode-range for rubik-hebrew).
const HEBREW_GLYPH = /[̇̈֐-׿‌-‐₪◌יִ-ﭏ]/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "{": "}", "}": "{" };
// Inside a number or a date these stay with it: "29,000", "01/01/2026", "−$1,250.50", "30%".
const NUMBER_JOINER = /[.,/:\-−+]/;

const DIGIT = /[0-9]/;
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
const CLOSE = new Set(Object.values(OPEN));

function kindOf(char: string): Kind {
  if (HEBREW.test(char)) return "R";
  if (DIGIT.test(char)) return "E";
  if (STRONG_L.test(char)) return "L";
  return "N";
}

/**
 * The line's runs in logical order, by the Unicode bidi rules a browser applies to the same text in a
 * right-to-left block (one paragraph, no embeddings): a number after a Latin letter is Latin (W7); a number
 * after Hebrew or at the start is drawn left to right but counts as Hebrew for the neutrals beside it (N1);
 * a bracket pair takes the direction of what it holds (N0). A joiner inside a number or a date range keeps
 * it whole ("29,000", "01/01/2026–31/10/2026"), and a sign before a number joins it ("−$1,250"), as the
 * app's ltr() isolates them.
 */
export function bidiRuns(text: string): { text: string; rtl: boolean }[] {
  const chars = [...text];
  const kinds = chars.map(kindOf);
  let strong: "R" | "L" = "R";
  for (let i = 0; i < kinds.length; i += 1) {
    if (kinds[i] === "R" || kinds[i] === "L") strong = kinds[i] as "R" | "L";
    else if (kinds[i] === "E" && strong === "L") kinds[i] = "L";
  }
  for (let i = 0; i < kinds.length; i += 1) {
    const char = chars[i] ?? "";
    if (kinds[i] !== "N" || !(NUMBER_JOINER.test(char) || char === "–")) continue;
    const next = kinds[i + 1];
    const prev = kinds[i - 1];
    if (next !== "E" && next !== "L") continue;
    if (prev === next || (/[-−+]/.test(char) && prev !== "E" && prev !== "L")) kinds[i] = next;
  }
  const nearest = (from: number, step: 1 | -1): Kind => {
    for (let i = from; i >= 0 && i < kinds.length; i += step) if (kinds[i] !== "N") return kinds[i] as Kind;
    return "R";
  };
  const stack: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? "";
    if (OPEN[char] != null) { stack.push(i); continue; }
    if (!CLOSE.has(char)) continue;
    const at = stack.findLastIndex((open) => OPEN[chars[open] ?? ""] === char);
    if (at < 0) continue;
    const open = stack[at] as number;
    stack.length = at;
    const inside = kinds.slice(open + 1, i);
    const dir: Kind = inside.some((kind) => kind === "R" || kind === "E") ? "R" : inside.includes("L") ? (nearest(open - 1, -1) === "L" ? "L" : "R") : "N";
    if (dir !== "N") { kinds[open] = dir; kinds[i] = dir; }
  }
  const resolved: ("R" | "L")[] = kinds.map((kind, index) => {
    if (kind === "R" || kind === "L") return kind;
    if (kind === "E") return "L";
    const before = nearest(index - 1, -1);
    // The "…" of a shortened line ends the text it cuts: "Riverside Commons…".
    if (chars[index] === "…") return before === "L" ? "L" : "R";
    return before === "L" && nearest(index + 1, 1) === "L" ? "L" : "R";
  });
  const runs: { text: string; rtl: boolean }[] = [];
  chars.forEach((char, index) => {
    const rtl = resolved[index] === "R";
    const last = runs[runs.length - 1];
    if (last != null && last.rtl === rtl) last.text += char;
    else runs.push({ text: char, rtl });
  });
  return runs;
}

/** The line in visual order, split by the subset each glyph comes from. */
export function visualSegments(text: string): Segment[] {
  const runs = bidiRuns(text).reverse();
  const visual = runs.map((run) => (run.rtl ? [...run.text].reverse().map((char) => MIRROR[char] ?? char).join("") : run.text)).join("");
  const segments: Segment[] = [];
  for (const char of visual) {
    const script: Script = HEBREW_GLYPH.test(char) ? "hebrew" : "latin";
    const last = segments[segments.length - 1];
    if (last != null && last.script === script) last.text += char;
    else segments.push({ text: char, script });
  }
  return segments;
}
