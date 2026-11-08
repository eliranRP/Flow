import { type CashLine, type ProjectCashRow, type ProjectsCashMonth, type SearchRow } from "@flow/shared";
import type { ScheduleRow } from "./recurring-schedule";

/**
 * FLOW-445: the Projects tab's list, as pure functions. The rows come from `projects_cash_month`;
 * the screen only lays them out.
 */

type Cash = ProjectCashRow["cash"];

/** A project's net for the month in one currency (minor units); zero when it has no line in it. */
export function netIn(cash: Cash, currency: string): number {
  return cash.find((row) => row.currency === currency)?.net_minor ?? 0;
}

/** "חדש" while the project has no line, invoice or month. A finished project shows "הסתיים" instead. */
export function projectStatusWord(row: Pick<ProjectCashRow, "status" | "first_month" | "is_overhead">): string | undefined {
  if (row.status === "finished") return "הסתיים";
  if (!row.is_overhead && row.first_month == null) return "חדש";
  return undefined;
}

/** The meta line: the owner's own type, then the status; "פעיל" when there is neither. */
export function projectMeta(row: ProjectCashRow): string {
  const parts = [row.type ?? undefined, projectStatusWord(row)].filter((part): part is string => part != null && part !== "");
  return parts.length > 0 ? parts.join(" · ") : "פעיל";
}

/** True when spent is over the budget (the "מעל התקציב" hint). */
export function isOverBudget(row: Pick<ProjectCashRow, "budget_minor" | "spent_minor">): boolean {
  return row.budget_minor != null && row.spent_minor > row.budget_minor;
}

/**
 * Active projects in the list's order: the new ones first (newest first), then the biggest cash
 * movement this month (by its size), ties by name. The overhead project is not in this list.
 */
export function orderActiveProjects(rows: ProjectCashRow[], currency: string): ProjectCashRow[] {
  const active = rows.filter((row) => row.status === "active" && !row.is_overhead);
  const rank = (row: ProjectCashRow) => (projectStatusWord(row) === "חדש" ? 0 : 1);
  return [...active].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 0) {
      const byCreated = b.created_at.localeCompare(a.created_at);
      if (byCreated !== 0) return byCreated;
    } else {
      const bySize = Math.abs(netIn(b.cash, currency)) - Math.abs(netIn(a.cash, currency));
      if (bySize !== 0) return bySize;
    }
    return a.name.localeCompare(b.name, "he");
  });
}

/** The unassigned line count in words for the list's link: one line, or N lines. */
export function unassignedCountLabel(count: number): string {
  return count === 1 ? "שורה אחת בלי פרויקט" : `${String(count)} שורות בלי פרויקט`;
}

/**
 * FLOW-1044 (BUILD-PLAN §5): what kind of project a row is. The new-project sheet stores its pick as the type
 * word, so a type that names a kind wins; otherwise the data decides: a budget or an ARV is a renovation, a rent
 * or a property value a rental, anything else a client project. The company's overhead project is overhead.
 */
export type ProjectKind = "renovation" | "rental" | "client" | "overhead";

/** The kinds in the list's order, with the word the sheet stores and the group head shows. */
export const PROJECT_KINDS: readonly { kind: ProjectKind; label: string }[] = [
  { kind: "renovation", label: "שיפוץ" },
  { kind: "rental", label: "השכרה" },
  { kind: "client", label: "לקוח" },
  { kind: "overhead", label: "תקורה" },
];

const KIND_WORDS: readonly (readonly [ProjectKind, RegExp])[] = [
  ["overhead", /תקורה|overhead/iu],
  ["renovation", /שיפוץ|פליפ|flip|renovat|rehab/iu],
  ["rental", /השכרה|שכירות|rent/iu],
  ["client", /לקוח|client/iu],
];

/** The kind a type word names ("flip", "השכרה"), or null when it names none. */
export function kindFromType(type: string | null | undefined): ProjectKind | null {
  if (type == null || type.trim() === "") return null;
  return KIND_WORDS.find(([, words]) => words.test(type))?.[0] ?? null;
}

/** What the page or the row knows about a project, for its kind. */
export type KindSignals = {
  overhead: boolean;
  type: string | null;
  budget?: boolean;
  arv?: boolean;
  rent?: boolean;
  value?: boolean;
};

export function resolveProjectKind(signals: KindSignals): ProjectKind {
  if (signals.overhead) return "overhead";
  const named = kindFromType(signals.type);
  if (named != null) return named;
  if (signals.budget === true || signals.arv === true) return "renovation";
  if (signals.rent === true || signals.value === true) return "rental";
  return "client";
}

/** A row of the month's list: its kind from its type, its budget and the overhead flag. */
export function rowKind(row: Pick<ProjectCashRow, "is_overhead" | "type" | "budget_minor">): ProjectKind {
  return resolveProjectKind({ overhead: row.is_overhead, type: row.type, budget: row.budget_minor != null });
}

export function kindLabel(kind: ProjectKind): string {
  return PROJECT_KINDS.find((entry) => entry.kind === kind)?.label ?? "";
}

/** The list's filter, in the board's order: פעילים, הסתיימו, הכול. */
export type ProjectsFilter = "active" | "finished" | "all";

export type ProjectKindGroup = { kind: ProjectKind; title: string; rows: ProjectCashRow[]; net: number };

/**
 * FLOW-1044: the list's rows in groups by kind (שיפוץ, השכרה, לקוח, תקורה), each with the month's net in the
 * list's currency. Active rows keep the list's order (orderActiveProjects); finished ones follow, the latest
 * finished first. The overhead project counts as active. A kind with no row is left out.
 */
export function groupProjectRows(rows: readonly ProjectCashRow[], filter: ProjectsFilter, currency: string): ProjectKindGroup[] {
  const active = filter === "finished" ? [] : [
    ...orderActiveProjects([...rows], currency),
    ...rows.filter((row) => row.is_overhead && row.status === "active"),
  ];
  const finished = filter === "active" ? [] : rows
    .filter((row) => row.status === "finished")
    .sort((a, b) => (b.finished_on ?? "").localeCompare(a.finished_on ?? "") || a.name.localeCompare(b.name, "he"));
  const ordered = [...active, ...finished];
  return PROJECT_KINDS.flatMap(({ kind, label }) => {
    const inKind = ordered.filter((row) => rowKind(row) === kind);
    if (inKind.length === 0) return [];
    return [{ kind, title: label, rows: inKind, net: inKind.reduce((sum, row) => sum + netIn(row.cash, currency), 0) }];
  });
}

/** The band's figures: the month's in, out and net across every project, in the list's currency. */
export function projectsMonthTotals(month: NonNullable<ProjectsCashMonth>): { in: number; out: number; net: number } {
  const lines = month.projects.flatMap((row) => row.cash.filter((line) => line.currency === month.base_currency));
  return {
    in: lines.reduce((sum, line) => sum + line.in_minor, 0),
    out: lines.reduce((sum, line) => sum + line.out_minor, 0),
    net: lines.reduce((sum, line) => sum + line.net_minor, 0),
  };
}

/** Spent against the budget, as a whole percent; null with no budget. */
export function budgetPercent(row: Pick<ProjectCashRow, "budget_minor" | "spent_minor">): number | null {
  if (row.budget_minor == null || row.budget_minor <= 0) return null;
  return Math.floor((row.spent_minor * 100) / row.budget_minor);
}

/** The attention card's line: a budget past this share is worth a look. */
export const BUDGET_ALERT_PERCENT = 80;

/** One month of the lines with no project: its rows, newest first, and their net in the first currency. */
export type UnassignedGroup = { month: string; rows: SearchRow[]; net: bigint; currency: string };

/**
 * FLOW-1044: the lines with no project, in month groups, newest month first, each with its count and its net
 * (income minus expenses) in its first line's currency. A kept-out line counts nothing, as in search.
 */
export function groupUnassignedRows(rows: readonly SearchRow[]): UnassignedGroup[] {
  const byMonth = new Map<string, SearchRow[]>();
  for (const row of rows) {
    const month = row.doc_date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), row]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, inMonth]) => {
      const currency = inMonth[0]?.currency ?? "ILS";
      const net = inMonth
        .filter((row) => row.currency === currency && !row.kept_out)
        .reduce((sum, row) => sum + (row.direction === "income" ? abs(row.amount_net) : -abs(row.amount_net)), 0n);
      return { month, rows: [...inMonth].sort((a, b) => b.doc_date.localeCompare(a.doc_date)), net, currency };
    });
}

function abs(minor: bigint): bigint {
  return minor < 0n ? -minor : minor;
}

/**
 * The project the picker offers first for a line: the active project whose name its category names (a category
 * kept for one property, "Lark Hill · repairs"). Null when no category points to one, or several do.
 */
export function suggestedProject<T extends { id: string; name: string }>(categoryName: string | null, projects: readonly T[]): T | null {
  if (categoryName == null || categoryName.trim() === "") return null;
  const text = categoryName.toLowerCase();
  const named = projects.filter((project) => project.name.trim().length > 1 && text.includes(project.name.trim().toLowerCase()));
  return named.length === 1 ? (named[0] ?? null) : null;
}

/**
 * FLOW-1112: a month line's key on the project page. The page lists the counted and the kept-out reads together,
 * and a line split between a part counted in profit and one kept out comes back in both on the same side, so
 * whether the row counts in profit is part of its key.
 */
export function monthLineKey(line: Pick<CashLine, "transaction_id" | "part" | "side" | "in_pnl">): string {
  return `${line.transaction_id}:${line.part ?? ""}:${line.side}:${line.in_pnl === false ? "kept" : "counted"}`;
}

/** The project page's filter, as on Home: הכול, קבועים, נותר לשלם. */
export type ProjectLinesFilter = "all" | "fixed" | "left";

export type ProjectLineGroups = {
  /** Recurring charges not in yet this month: the late ones first, then by their day. */
  left: ScheduleRow[];
  /** Recurring charges that arrived this month. */
  paid: ScheduleRow[];
  /**
   * FLOW-1112 (owner, 2026-11-08: "under all we need to see recurring payments and any transactions that occurred
   * this month"): under הכול, every line of the month, in and out, newest first; empty under the other filters.
   */
  lines: CashLine[];
};

/**
 * FLOW-1044: the project page's month in groups, from the schedule's rows for the project and the month's
 * lines. FLOW-1112: הכול lists every line of the month under the recurring groups, a recurring charge's own
 * lines included, so a payer's other line (a recurring tenant's water payment) is never hidden.
 */
export function projectLineGroups(schedule: readonly ScheduleRow[], lines: readonly CashLine[], projectId: string, filter: ProjectLinesFilter): ProjectLineGroups {
  const own = schedule.filter((row) => row.project_id === projectId);
  const left = own
    .filter((row) => row.state === "late" || row.state === "soon")
    .sort((a, b) => Number(b.state === "late") - Number(a.state === "late") || a.typical_day - b.typical_day);
  const paid = filter === "left" ? [] : own.filter((row) => row.state === "arrived");
  const month = filter !== "all" ? [] : [...lines].sort((a, b) => b.cash_month_date.localeCompare(a.cash_month_date) || b.doc_date.localeCompare(a.doc_date));
  return { left, paid, lines: month };
}
