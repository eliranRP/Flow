import { wholeShekels } from "@flow/shared";
import { monthTitle } from "./date-math";

export type MonthAmount = { minor: bigint; currency: string; direction: "income" | "expense" };

export type MonthTotal = { currency: string; incomeMinor: bigint; expenseMinor: bigint };

export type MonthGroup<T> = { key: string; title: string; rows: T[]; totals: MonthTotal[] };

const MONTH_KEY = /^(\d{4})-(\d{2})/;

/**
 * Rows grouped by calendar month, in the order the rows appear. Rows are never reordered.
 * Null means "render the flat list": fewer than two months, a date that can't be read,
 * or a month that shows up in two separate runs (a held order or another sort broke the
 * date order), since two partial subtotals for one month would not match the month.
 * Each total adds up each row's shown whole-unit value, so the header matches the rows.
 */
export function groupByMonth<T>(
  rows: readonly T[],
  dateOf: (row: T) => string,
  amountOf: (row: T) => MonthAmount,
): MonthGroup<T>[] | null {
  const groups: MonthGroup<T>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const match = MONTH_KEY.exec(dateOf(row));
    if (!match) return null;
    const key = `${match[1] ?? ""}-${match[2] ?? ""}`;
    let group = groups.at(-1);
    if (group?.key !== key) {
      if (seen.has(key)) return null;
      seen.add(key);
      group = { key, title: monthTitle(Number(match[1]), Number(match[2]) - 1), rows: [], totals: [] };
      groups.push(group);
    }
    group.rows.push(row);
    addTo(group.totals, amountOf(row));
  }
  if (groups.length < 2) return null;
  for (const group of groups) group.totals.sort(byCurrency);
  return groups;
}

function addTo(totals: MonthTotal[], amount: MonthAmount): void {
  const abs = amount.minor < 0n ? -amount.minor : amount.minor;
  const shown = BigInt(wholeShekels(abs)) * 100n;
  let total = totals.find((item) => item.currency === amount.currency);
  if (!total) {
    total = { currency: amount.currency, incomeMinor: 0n, expenseMinor: 0n };
    totals.push(total);
  }
  if (amount.direction === "income") total.incomeMinor += shown;
  else total.expenseMinor += shown;
}

/** ILS first; the others keep the order they first appear in (the sort is stable). */
function byCurrency(a: MonthTotal, b: MonthTotal): number {
  return (a.currency === "ILS" ? 0 : 1) - (b.currency === "ILS" ? 0 : 1);
}
