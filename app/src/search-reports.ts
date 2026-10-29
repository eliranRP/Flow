import { reportsTo, type ReportKind } from "./reports";

/**
 * FLOW-163: the search's way into the reports (board "How the user gets to דוחות", ReportEntrySearch).
 * Typing a report's name, or the start of it, shows a row that opens that report: מאזן opens the
 * balance sheet, רווח והפסד the P&L, דוחות both. With a project's name beside it ("מאזן Cedar"),
 * the row opens the report on that project.
 */
export type ReportShortcut = {
  key: string;
  kind: ReportKind;
  title: string;
  hint: string;
  to: string;
};

/** The words for each report, normalized (lower case, no quotes or gershayim, single spaces). */
const KEYWORDS: Record<ReportKind, readonly string[]> = {
  balance: ["מאזן", "מאזנים", "balance sheet", "balance"],
  pnl: ["רווח והפסד", "רווח הפסד", "רוה", "p&l", "pnl", "p & l", "profit and loss", "profit & loss", "income statement"],
};

/** Words that name the reports in general: both rows, or left out around a report's own name. */
const GENERAL = ["דוחות", "דוח", "דוחות כספיים", "reports", "report", "statements", "statement"];

/** Fewer letters than this match no report by their start alone ("מא" is too many things). */
const MIN_PREFIX = 3;

/** A project's name beside a report's needs this many letters. */
const MIN_PROJECT = 2;

export function normalizeReportText(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'׳״`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text with `word` taken out once, as a whole word. Null when the word is not in it. */
function without(text: string, word: string): string | null {
  const at = ` ${text} `.indexOf(` ${word} `);
  if (at < 0) return null;
  return `${text.slice(0, at)} ${text.slice(at + word.length)}`.replace(/\s+/g, " ").trim();
}

/** What is left once the general words and the small joining words are out. */
function strip(text: string): string {
  let rest = text;
  for (const word of [...GENERAL].sort((a, b) => b.length - a.length)) rest = without(rest, word) ?? rest;
  for (const word of ["של", "ל", "for", "of"]) rest = without(rest, word) ?? rest;
  return rest;
}

/** Which reports the text names, and the text left beside the name. */
function matchKinds(text: string): { kinds: ReportKind[]; rest: string } | null {
  for (const kind of ["balance", "pnl"] as const) {
    for (const word of [...KEYWORDS[kind]].sort((a, b) => b.length - a.length)) {
      const rest = without(text, word);
      if (rest != null) return { kinds: [kind], rest: strip(rest) };
    }
  }
  if (text.length >= MIN_PREFIX) {
    for (const kind of ["balance", "pnl"] as const) {
      if (KEYWORDS[kind].some((word) => word.startsWith(text))) return { kinds: [kind], rest: "" };
    }
  }
  const general = [...GENERAL].sort((a, b) => b.length - a.length);
  for (const word of general) {
    const rest = without(text, word);
    if (rest != null) return { kinds: ["pnl", "balance"], rest: strip(rest) };
  }
  if (text.length >= MIN_PREFIX && general.some((word) => word.startsWith(text))) return { kinds: ["pnl", "balance"], rest: "" };
  return null;
}

const NAMES: Record<ReportKind, { title: string; when: string }> = {
  pnl: { title: "רווח והפסד", when: "השנה" },
  balance: { title: "מאזן", when: "היום" },
};

/**
 * The report rows for the typed text: none when it names no report. `search` is the preview query
 * the links keep.
 */
export function reportShortcuts(
  typed: string,
  projects: readonly { id: string; name: string }[],
  search = "",
): ReportShortcut[] {
  const text = normalizeReportText(typed);
  if (text === "") return [];
  const match = matchKinds(text);
  if (match == null) return [];
  const project = match.rest.length >= MIN_PROJECT
    ? projects.find((row) => normalizeReportText(row.name).includes(match.rest)) ?? null
    : null;
  return match.kinds.map((kind) => {
    const { title, when } = NAMES[kind];
    return project == null
      ? { key: kind, kind, title, hint: `כל הפרויקטים · ${when}`, to: reportsTo(kind, { kind: "all" }, search) }
      : { key: `${kind}-${project.id}`, kind, title: `${title} · ${project.name}`, hint: when, to: reportsTo(kind, { kind: "project", id: project.id }, search) };
  });
}
