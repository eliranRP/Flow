import { reportsTo, type ReportKind } from "./reports";

/**
 * FLOW-163: the search's way into the reports (board "How the user gets to דוחות", ReportEntrySearch).
 * Typing a report's name, or the start of it, shows a row that opens that report: מאזן opens the
 * balance sheet, רווח והפסד the P&L, דוחות both. With a project's name beside it ("מאזן Cedar"),
 * the row opens the report on that project.
 *
 * FLOW-169: a Hebrew prefix letter (ה ב ל ו מ, one or two of them) on a report's word or on the
 * project's name still matches ("המאזן", "מאזן לשיפוץ"), and punctuation around the words is
 * ignored ("מאזן?", "רווח והפסד, Cedar"). The letters come off only when what is left is a report's
 * word or a project's name, so "מאזניים" still names nothing.
 */
export type ReportShortcut = {
  key: string;
  title: string;
  hint: string;
  to: string;
};

/** The words for each report, normalized (lower case, no quotes or gershayim, single spaces). */
const KEYWORDS: Record<ReportKind, readonly string[]> = {
  // "balance" alone names the balance sheet only as the whole query (BALANCE_ALONE): beside other
  // words it is a line's own text ("balance transfer").
  balance: ["מאזן", "מאזנים", "balance sheet"],
  pnl: ["רווח והפסד", "רווח הפסד", "רוה", "רווה", "p&l", "pnl", "p & l", "profit and loss", "profit & loss", "income statement"],
};

/** Words that name the reports in general: both rows, or left out around a report's own name. */
const GENERAL = ["דוחות", "דוח", "דוחות כספיים", "reports", "report", "statements", "statement"];

/** "balance" as the entire query is the balance sheet. */
const BALANCE_ALONE = "balance";

/** The Hebrew prefix letters a word can carry: the, in, to, and, from (FLOW-169). */
const PREFIXES = ["ה", "ב", "ל", "ו", "מ"] as const;

/** Short forms that take no prefix: "מרווה" is a word (sage), not "מ" before "רווה". */
const NO_PREFIX = new Set(["רוה", "רווה"]);

/** The word as typed, then with one and two prefix letters off: "והמאזן", "המאזן", "מאזן". */
function prefixForms(word: string): string[] {
  const forms = [word];
  for (let at = 0; at < 2 && at < word.length - 1 && PREFIXES.some((letter) => letter === word[at]); at += 1) {
    forms.push(word.slice(at + 1));
  }
  return forms;
}

/** Fewer letters than this match no report by their start alone ("מא" is too many things). */
const MIN_PREFIX = 3;

/** Only the Hebrew names match by their start: "pro", "inc" or "rep" begin too many English words. */
const HEBREW = /[\u0590-\u05FF]/;

function startsName(words: readonly string[], text: string): boolean {
  return text.length >= MIN_PREFIX && HEBREW.test(text) && words.some((word) => word.startsWith(text));
}

/** A project's name beside a report's needs this many letters. */
const MIN_PROJECT = 2;

export function normalizeReportText(text: string): string {
  return text
    .toLowerCase()
    // Straight and typographic quotes (iOS smart punctuation types ” for "), geresh and gershayim.
    .replace(/["'׳״`\u2018\u2019\u201C\u201D]/g, "")
    // FLOW-169: punctuation around or between the words is a space ("מאזן?", "רווח והפסד, Cedar").
    // "&" stays: it is part of "p&l".
    .replace(/[?!.,;:()[\]{}<>/\\|~*+=_…\u05BE\u2010-\u2015-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text with `word` taken out once, as a whole word. Null when the word is not in it. */
function without(text: string, word: string): string | null {
  const at = ` ${text} `.indexOf(` ${word} `);
  if (at < 0) return null;
  return `${text.slice(0, at)} ${text.slice(at + word.length)}`.replace(/\s+/g, " ").trim();
}

/**
 * As `without`, but the word may carry one or two Hebrew prefix letters ("במאזן", "והמאזן").
 * Only a Hebrew word takes them.
 */
function withoutPrefixed(text: string, word: string): string | null {
  const plain = without(text, word);
  if (plain != null || !HEBREW.test(word) || NO_PREFIX.has(word)) return plain;
  for (const first of PREFIXES) {
    const one = without(text, `${first}${word}`);
    if (one != null) return one;
    for (const second of PREFIXES) {
      const two = without(text, `${first}${second}${word}`);
      if (two != null) return two;
    }
  }
  return null;
}

/** What is left once the general words and the small joining words are out. */
function strip(text: string): string {
  let rest = text;
  for (const word of [...GENERAL].sort((a, b) => b.length - a.length)) rest = withoutPrefixed(rest, word) ?? rest;
  for (const word of ["של", "ל", "for", "of"]) rest = without(rest, word) ?? rest;
  return rest;
}

/** Which reports the text names, and the text left beside the name. */
function matchKinds(text: string): { kinds: ReportKind[]; rest: string; general: boolean } | null {
  if (text === BALANCE_ALONE) return { kinds: ["balance"], rest: "", general: false };
  for (const kind of ["balance", "pnl"] as const) {
    for (const word of [...KEYWORDS[kind]].sort((a, b) => b.length - a.length)) {
      const rest = withoutPrefixed(text, word);
      if (rest != null) return { kinds: [kind], rest: strip(rest), general: false };
    }
  }
  for (const kind of ["balance", "pnl"] as const) {
    if (startsName(KEYWORDS[kind], text)) return { kinds: [kind], rest: "", general: false };
  }
  const general = [...GENERAL].sort((a, b) => b.length - a.length);
  for (const word of general) {
    const rest = withoutPrefixed(text, word);
    if (rest != null) return { kinds: ["pnl", "balance"], rest: strip(rest), general: true };
  }
  if (startsName(general, text)) return { kinds: ["pnl", "balance"], rest: "", general: true };
  return null;
}

const NAMES: Record<ReportKind, { title: string; when: string }> = {
  pnl: { title: "רווח והפסד", when: "השנה" },
  balance: { title: "מאזן", when: "היום" },
};

type ProjectRow = { id: string; name: string };

/**
 * The project the words beside the report's name point to: the words as typed, then with a prefix
 * letter off. A form with the letters off needs MIN_PREFIX letters and must start a word of the name,
 * so "דוח מים" (a water bill) does not read "ים" inside "הגפנים".
 */
function namedProject(rest: string, projects: readonly ProjectRow[]): ProjectRow | null {
  const [typed = "", ...stripped] = prefixForms(rest);
  if (typed.length < MIN_PROJECT) return null;
  const asTyped = projects.find((row) => normalizeReportText(row.name).includes(typed));
  if (asTyped != null) return asTyped;
  for (const form of stripped) {
    if (form.length < MIN_PREFIX) break;
    const project = projects.find((row) => ` ${normalizeReportText(row.name)}`.includes(` ${form}`));
    if (project != null) return project;
  }
  return null;
}

/**
 * The report rows for the typed text: none when it names no report. `search` is the preview query
 * the links keep. `chipProject` is the search's project filter (FLOW-169): with it on, the rows open
 * on that project, unless the text names another project.
 */
export function reportShortcuts(
  typed: string,
  projects: readonly ProjectRow[],
  search = "",
  chipProject: ProjectRow | null = null,
): ReportShortcut[] {
  const text = normalizeReportText(typed);
  if (text === "") return [];
  const match = matchKinds(text);
  if (match == null) return [];
  const named = namedProject(match.rest, projects);
  // "דוח" beside words that name no project is a line's own text ("דוח חניה", "דו״ח שמאי"), not the reports.
  if (match.general && match.rest !== "" && named == null) return [];
  const project = named ?? chipProject;
  return match.kinds.map((kind) => {
    const { title, when } = NAMES[kind];
    return project == null
      ? { key: kind, title, hint: `כל הפרויקטים · ${when}`, to: reportsTo(kind, { kind: "all" }, search) }
      : { key: `${kind}-${project.id}`, title: `${title} · ${project.name}`, hint: when, to: reportsTo(kind, { kind: "project", id: project.id }, search) };
  });
}
