// FLOW-162: right-to-left text for the report PDF. A PDF draws glyphs left to right, so a Hebrew line is laid
// out here in visual order: the line splits into runs of Hebrew and of left-to-right text (Latin, digits and the
// money signs), the runs go from right to left, a Hebrew run's letters are reversed (brackets mirrored), and a
// left-to-right run keeps its order ("$29,000", "Cedar St", "01/01/2026"). Neutral characters between two
// left-to-right runs join them; any other neutral takes the line's right-to-left direction.

export type Script = "hebrew" | "latin";
/** One piece to draw, in visual order (left to right), with the subset that holds its glyphs. */
export type Segment = { text: string; script: Script };

type Kind = "R" | "L" | "N";

const HEBREW = /[֐-׿יִ-ﭏ]/;
const STRONG_L = /[A-Za-z0-9À-ɏ$€£₪%]/;
// Glyphs the Hebrew subset holds besides the letters (fontsource's unicode-range for rubik-hebrew).
const HEBREW_GLYPH = /[̇̈֐-׿‌-‐₪◌יִ-ﭏ]/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "{": "}", "}": "{" };
// Inside a number or a date these stay with it: "29,000", "01/01/2026", "−$1,250.50", "30%".
const NUMBER_JOINER = /[.,/:\-−+]/;

function kindOf(char: string): Kind {
  if (HEBREW.test(char)) return "R";
  if (STRONG_L.test(char)) return "L";
  return "N";
}

/** The line's runs in logical order, every neutral resolved to the direction around it. */
export function bidiRuns(text: string): { text: string; rtl: boolean }[] {
  const chars = [...text];
  const kinds = chars.map(kindOf);
  const resolved: ("R" | "L")[] = kinds.map((kind, index) => {
    if (kind !== "N") return kind;
    // A joiner inside a number keeps it whole; any neutral between two left-to-right runs joins them.
    let before: Kind = "R";
    for (let i = index - 1; i >= 0; i -= 1) {
      if (kinds[i] !== "N") { before = kinds[i] as Kind; break; }
    }
    let after: Kind = "R";
    for (let i = index + 1; i < kinds.length; i += 1) {
      if (kinds[i] !== "N") { after = kinds[i] as Kind; break; }
    }
    if (before === "L" && after === "L") return "L";
    // The "…" of a shortened line ends the text it cuts: "Riverside Commons…".
    if (chars[index] === "…") return before === "L" ? "L" : "R";
    // A minus or a sign right before a number belongs to it ("−$1,250").
    if (after === "L" && NUMBER_JOINER.test(chars[index] ?? "") && kinds[index + 1] === "L") return "L";
    return "R";
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
