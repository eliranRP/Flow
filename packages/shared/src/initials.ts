/**
 * Avatar initials for a statement row (FLOW-305): the first letter of the first two words,
 * when both are in the same script ("חשמל השרון" → "חה", "Northwind Traders"
 * → "NT"). One word, or a script change between the first two words: one letter. Legal suffixes
 * (בע״מ, Inc, LLC, Ltd, Co, Corp, GmbH) are dropped. Digits and symbols are skipped. Latin is
 * upper-cased and Hebrew final forms map to the base letter. Null when the name has no letter,
 * so the caller draws the source icon instead.
 */
export type Initials = { text: string; dir: "rtl" | "ltr" };

const SUFFIXES = new Set(["בע״מ", 'בע"מ', "בע'מ", "בעמ", "inc", "llc", "ltd", "co", "corp", "gmbh"]);

const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

const WORD = /[א-ת]+|[A-Za-z]+/g;

function scriptOf(word: string): "rtl" | "ltr" {
  return /^[A-Za-z]/.test(word) ? "ltr" : "rtl";
}

function letterOf(word: string): string {
  const first = word.charAt(0);
  return FINALS[first] ?? first.toUpperCase();
}

/** Strips the edges of a token so "Ltd." and "(בע״מ)" match the suffix list. */
function bare(token: string): string {
  return token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase();
}

export function initialsOf(name: string | null | undefined): Initials | null {
  if (name == null) return null;
  const tokens = name.split(/\s+/).filter((token) => token !== "");
  const kept = tokens.filter((token) => !SUFFIXES.has(bare(token)));
  const source = kept.length > 0 ? kept : tokens;
  const words = source.flatMap((token) => token.match(WORD) ?? []);
  const [first, second] = words;
  if (first == null) return null;
  const dir = scriptOf(first);
  if (second != null && scriptOf(second) === dir) {
    return { text: letterOf(first) + letterOf(second), dir };
  }
  return { text: letterOf(first), dir };
}
