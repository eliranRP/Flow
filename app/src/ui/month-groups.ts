import { wholeShekels } from "@flow/shared";
import { israelToday, monthTitle, pad, WEEKDAY_HEADS } from "./date-math";

export type MonthAmount = { minor: bigint; currency: string; direction: "income" | "expense" };

export type MonthTotal = { currency: string; incomeMinor: bigint; expenseMinor: bigint };

export type MonthGroup<T> = { key: string; title: string; rows: T[]; totals: MonthTotal[] };

export type DayGroup<T> = { key: string; title: string; rows: T[] };

const MONTH_KEY = /^(\d{4})-(\d{2})/;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Rows grouped by calendar month, in the order the rows appear. Rows are never reordered.
 * Null means "render the flat list": fewer than two months, a date that can't be read,
 * or a month that shows up in two separate runs (a held order or another sort broke the
 * date order), since two partial subtotals for one month would not match the month.
 * Each total adds up each row's shown value, so the header matches the rows: whole units,
 * or the exact minor units when the rows show cents (`cents`, FLOW-305).
 */
export function groupByMonth<T>(
  rows: readonly T[],
  dateOf: (row: T) => string,
  amountOf: (row: T) => MonthAmount,
  cents = false,
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
    addTo(group.totals, amountOf(row), cents);
  }
  if (groups.length < 2) return null;
  for (const group of groups) group.totals.sort(byCurrency);
  return groups;
}

/**
 * Rows split into days, in the order the rows appear (FLOW-305). A held row that breaks the day
 * order stays under the day it was drawn under: a day head is never repeated. Null when a date
 * can't be read, so the caller draws the rows with no day heads.
 */
export function groupByDay<T>(rows: readonly T[], dateOf: (row: T) => string, now = new Date()): DayGroup<T>[] | null {
  const groups: DayGroup<T>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const match = DAY_KEY.exec(dateOf(row));
    if (!match) return null;
    const key = match[0];
    let group = groups.at(-1);
    if (group == null || (group.key !== key && !seen.has(key))) {
      seen.add(key);
      group = { key, title: dayTitle(key, now), rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/** "היום", "אתמול", else "יום ב׳ · 05/10"; another year adds the year. Israel-time days. */
export function dayTitle(iso: string, now = new Date()): string {
  const today = israelToday(now);
  if (iso === today) return "היום";
  if (iso === shiftDay(today, -1)) return "אתמול";
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const weekday = WEEKDAY_HEADS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  const date = iso.slice(0, 4) === today.slice(0, 4) ? `${pad(day)}/${pad(month)}` : `${pad(day)}/${pad(month)}/${String(year)}`;
  return `יום ${weekday} · ${date}`;
}

function shiftDay(iso: string, delta: number): string {
  const date = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + delta));
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addTo(totals: MonthTotal[], amount: MonthAmount, cents: boolean): void {
  const abs = amount.minor < 0n ? -amount.minor : amount.minor;
  const shown = cents ? abs : BigInt(wholeShekels(abs)) * 100n;
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
