import type { CashLine } from "@flow/shared";
import type { CashListSide } from "./cash";

/**
 * FLOW-366. The month lines page's order and groups, as pure functions. Money is signed on the
 * page's side: money in is positive on נכנס, money out is positive on יצא, so a group's sum and
 * the page total add up to the figure Home shows for the side.
 */

export const LINES_ORDERS = ["date", "amount", "project", "category"] as const;
export type LinesOrder = (typeof LINES_ORDERS)[number];

/** The order in the URL (`?order=`). Date is the absent value. */
export function linesOrder(value: string | null | undefined): LinesOrder {
  return value === "amount" || value === "project" || value === "category" ? value : "date";
}

export const LINES_ORDER_LABEL: Record<LinesOrder, string> = {
  date: "לפי תאריך",
  amount: "לפי סכום",
  project: "לפי פרויקט",
  category: "לפי קטגוריה",
};

export type LineGroup = {
  key: string;
  title: string;
  /** The group's sum on the page's side; null when the order shows no sum (לפי סכום). */
  total: bigint | null;
  rows: CashLine[];
};

/** A line's amount on the page's side. On נכנס and יצא both are the side's own figure; on לא נספר ברווח each row keeps its own side. */
export function sideMinor(row: CashLine, side: CashListSide): bigint {
  if (side === "in") return row.amount_minor;
  if (side === "out") return -row.amount_minor;
  return row.side === "in" ? row.amount_minor : -row.amount_minor;
}

/** The day heads: "היום · dd/mm", "אתמול · dd/mm", otherwise "dd/mm" (no year). */
export function lineDayTitle(date: string, today: string): string {
  const day = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  if (date === today) return `היום · ${day}`;
  if (date === shiftIsoDay(today, -1)) return `אתמול · ${day}`;
  return day;
}

function shiftIsoDay(iso: string, delta: number): string {
  const time = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + delta);
  return new Date(time).toISOString().slice(0, 10);
}

/** Newest first, then by transaction, then by part, so ties keep one order. */
function byRecency(a: CashLine, b: CashLine): number {
  if (a.cash_month_date !== b.cash_month_date) return a.cash_month_date < b.cash_month_date ? 1 : -1;
  if (a.transaction_id !== b.transaction_id) return a.transaction_id < b.transaction_id ? -1 : 1;
  return (a.part ?? "") < (b.part ?? "") ? -1 : (a.part ?? "") > (b.part ?? "") ? 1 : 0;
}

function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function sumOf(rows: readonly CashLine[], side: CashListSide): bigint {
  return rows.reduce((total, row) => total + sideMinor(row, side), 0n);
}

/** Groups grouped by a text key: largest total first, a tie by the group's newest line. */
function byKey(rows: readonly CashLine[], side: CashListSide, keyOf: (row: CashLine) => string | null, emptyTitle: string): LineGroup[] {
  const map = new Map<string, CashLine[]>();
  for (const row of rows) {
    const key = keyOf(row) ?? "";
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  const groups = [...map.entries()].map(([key, members]) => {
    const sorted = [...members].sort(byRecency);
    return { key, title: key === "" ? emptyTitle : key, total: sumOf(sorted, side), rows: sorted };
  });
  return groups.sort((a, b) => {
    const diff = b.total > a.total ? 1 : b.total < a.total ? -1 : 0;
    if (diff !== 0) return diff;
    const [newestA] = a.rows;
    const [newestB] = b.rows;
    return newestA != null && newestB != null ? byRecency(newestA, newestB) : 0;
  });
}

/** The page's groups in its order. Every row is in exactly one group. */
export function groupLines(rows: readonly CashLine[], order: LinesOrder, side: CashListSide, today: string): LineGroup[] {
  if (order === "amount") {
    const sorted = [...rows].sort((a, b) => {
      const diff = magnitude(sideMinor(b, side)) - magnitude(sideMinor(a, side));
      if (diff !== 0n) return diff > 0n ? 1 : -1;
      return byRecency(a, b);
    });
    return sorted.length === 0 ? [] : [{ key: "amount", title: "מהגדול לקטן", total: null, rows: sorted }];
  }
  if (order === "project") return byKey(rows, side, (row) => row.project_name, "בלי פרויקט");
  if (order === "category") return byKey(rows, side, (row) => row.category_name, "בלי קטגוריה");
  const days = new Map<string, CashLine[]>();
  for (const row of rows) days.set(row.cash_month_date, [...(days.get(row.cash_month_date) ?? []), row]);
  return [...days.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((date) => {
      const sorted = [...(days.get(date) ?? [])].sort(byRecency);
      return { key: date, title: lineDayTitle(date, today), total: sumOf(sorted, side), rows: sorted };
    });
}

/** The count line's figures: every line, the ones awaiting review, and what profit leaves out. */
export function linesSummary(rows: readonly CashLine[], side: CashListSide): { total: bigint; count: number; pending: number; notInProfit: bigint } {
  let total = 0n;
  let pending = 0;
  let notInProfit = 0n;
  for (const row of rows) {
    total += sideMinor(row, side);
    if (row.pending === true) pending += 1;
    if (row.in_pnl === false) notInProfit += sideMinor(row, side);
  }
  return { total, count: rows.length, pending, notInProfit };
}

/**
 * A row's initials circle: the first letter of the first two words of the name, or the first two
 * letters of a one-word name (uppercased for Latin). "?" when there is no name.
 */
export function lineInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter((word) => word !== "");
  const [first, second] = words;
  if (first == null) return "?";
  if (second != null) return `${Array.from(first)[0] ?? ""}${Array.from(second)[0] ?? ""}`.toUpperCase();
  return Array.from(first).slice(0, 2).join("").toUpperCase();
}
