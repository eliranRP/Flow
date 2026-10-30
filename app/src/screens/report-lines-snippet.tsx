import { useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * FLOW-167 and FLOW-170: a line found by its description, on the reports drill-down's search, shows
 * the description as its title, up to three lines (`.ui-row-title-wrap`). This module picks where the
 * shown text starts, so the matched words land within those three lines.
 *
 * The rule, measured by layout, not by counting letters:
 * 1. The whole description, when every matched word shows within the three lines.
 * 2. Otherwise a cut before a matched word, after "…", trying the matches from the earliest: first two
 *    words before the match, then at the match's own word. The first cut that shows every matched
 *    word wins.
 * 3. When no cut shows them all, the one that shows the most; the earliest of those on a tie.
 * A description with no spaces is cut after the nearest / , - _ . : ; | before the match, or at the
 * match itself.
 */

/** The search's words, the way a line is matched: lower case, no thousands commas or money signs. */
export function searchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/״/g, '"')
    .replace(/׳/g, "'")
    // A figure as the row draws it: "−$1,388.00" reads as "1388.00". A comma between words stays a break.
    .replace(/(^|\s)[−+-](?=[$₪€£]?\d)/g, "$1")
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[$₪€£]/g, "")
    .replace(/[\s,]+/g, " ")
    .trim();
}

export function searchWords(query: string): string[] {
  return searchText(query).split(" ").filter((word) => word !== "");
}

/**
 * Where the search found `word` in the text, as `searchText` matches it ("1388" finds "1,388", `בע"מ`
 * finds "בע״מ"): [start, end) of the drawn letters; null when it is not there.
 */
function matchSpan(text: string, word: string): [number, number] | null {
  if (!searchText(text).includes(word)) return null;
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    const at = lower.indexOf(word);
    if (at >= 0) return [at, at + word.length];
  }
  let end = 0;
  for (let length = 1; end === 0 && length <= text.length; length += 1) {
    if (searchText(text.slice(0, length)).includes(word)) end = length;
  }
  let start = end - 1;
  while (start > 0 && !searchText(text.slice(start, end)).includes(word)) start -= 1;
  return [start, end];
}

/** A word longer than this, with no space in it, is cut at its punctuation or at the match (FLOW-170). */
const LONG_RUN = 16;
const BREAK = /[/,\-_.:;|\\]/;
/** How many words before the matched word the first cut keeps. */
const LEAD_WORDS = 2;

const isSpace = (char: string | undefined) => char != null && /\s/.test(char);

/**
 * The start of the word that holds position `at`: after the space before it. In a run longer than
 * LONG_RUN with no space, after the nearest punctuation before `at`, else at `at` itself.
 */
function wordStart(text: string, at: number): number {
  let start = at;
  while (start > 0 && !isSpace(text[start - 1])) start -= 1;
  if (at - start <= LONG_RUN) return start;
  for (let back = at; back > at - LONG_RUN; back -= 1) {
    if (BREAK.test(text[back - 1] ?? "")) return back;
  }
  return at;
}

/** LEAD_WORDS words before the word at `start`, so the match reads in its context. */
function leadStart(text: string, start: number): number {
  let lead = start;
  for (let word = 0; word < LEAD_WORDS; word += 1) {
    let end = lead;
    // Over the spaces and punctuation between the words ("room, ", "TANK/").
    while (end > 0 && (isSpace(text[end - 1]) || BREAK.test(text[end - 1] ?? ""))) end -= 1;
    if (end === 0) return 0;
    const begin = wordStart(text, end);
    if (begin === end) break;
    lead = begin;
  }
  return lead;
}

/** The matched words the description holds. */
function wordsIn(description: string, query: string): string[] {
  return searchWords(query).filter((word) => matchSpan(description, word) != null);
}

/** Where the shown text may start, in the order the rule tries them: the whole text (0) first. */
export function snippetCuts(description: string, query: string): number[] {
  const starts = wordsIn(description, query)
    .map((word) => matchSpan(description, word)?.[0] ?? 0)
    .sort((a, b) => a - b);
  const cuts = [0];
  for (const at of starts) {
    const word = wordStart(description, at);
    for (const cut of [leadStart(description, word), word]) if (!cuts.includes(cut)) cuts.push(cut);
  }
  return cuts;
}

/** The text drawn for a cut: whole, or from the cut after "…". */
export function snippetText(description: string, cut: number): string {
  return cut === 0 ? description : `…${description.slice(cut).trimStart()}`;
}

/** Steps 2 and 3: the first cut that shows all `words`, else the one that shows the most (the earliest). */
export function pickCut(shown: readonly number[], words: number): number {
  const all = shown.findIndex((count) => count >= words);
  if (all >= 0) return all;
  let best = 0;
  shown.forEach((count, index) => {
    if (count > (shown[best] ?? 0)) best = index;
  });
  return best;
}

/** How many of the words are drawn within the title's three lines. No layout (a test DOM) counts all. */
function wordsShown(node: HTMLElement, words: readonly string[]): number {
  const text = node.firstChild;
  const box = (node.closest(".ui-row-title-wrap") ?? node).getBoundingClientRect();
  if (text?.nodeType !== Node.TEXT_NODE || box.height === 0) return words.length;
  const drawn = text.textContent ?? "";
  let count = 0;
  for (const word of words) {
    const span = matchSpan(drawn, word);
    if (span == null) continue;
    const range = document.createRange();
    range.setStart(text, span[0]);
    range.setEnd(text, span[1]);
    if (typeof range.getBoundingClientRect !== "function") return words.length;
    const rect = range.getBoundingClientRect();
    if (rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) count += 1;
  }
  return count;
}

type Measure = { at: number; shown: number[]; done: boolean };
const START: Measure = { at: 0, shown: [], done: false };

/**
 * The description as the title draws it: each cut is laid out and measured before paint, in the rule's
 * order, until one shows every matched word. It measures again when the row's width changes. Give it
 * `key={query}`, so a new search starts over.
 */
export function SearchSnippet({ text, query }: { text: string; query: string }) {
  const cuts = useMemo(() => snippetCuts(text, query), [text, query]);
  const words = useMemo(() => wordsIn(text, query), [text, query]);
  const [measure, setMeasure] = useState<Measure>(START);
  const ref = useRef<HTMLSpanElement>(null);
  const width = useRef<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node == null || measure.done) return;
    const shown = [...measure.shown, wordsShown(node, words)];
    const last = measure.at >= cuts.length - 1;
    setMeasure(shown[shown.length - 1] === words.length || last
      ? { at: pickCut(shown, words.length), shown, done: true }
      : { at: measure.at + 1, shown, done: false });
  }, [measure, cuts, words]);
  useLayoutEffect(() => {
    const node = ref.current?.closest(".ui-row-title-wrap");
    if (node == null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (width.current != null && Math.abs(next - width.current) > 0.5) setMeasure(START);
      width.current = next;
    });
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, []);
  // Rubik loads with `font-display: swap`: a cut measured in the fallback font is measured again once it arrives.
  useLayoutEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (fonts == null || fonts.status === "loaded") return;
    let live = true;
    void fonts.ready.then(() => { if (live) setMeasure(START); });
    return () => { live = false; };
  }, []);
  return <span ref={ref}>{snippetText(text, cuts[measure.at] ?? 0)}</span>;
}
