// FLOW-364: Home's month logic, with no React. Amounts are bigint minor units, months are
// YYYY-MM keys and days are the Israel-local date (YYYY-MM-DD) that israelToday() returns.

import { shiftMonthKey } from "./period";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month Home shows: `?month=` clamped to [first, current], or (FLOW-1056, `withNext`) to the month after
 * the current one. Anything else, or no month, is the current month. `firstKey` is null when the books hold no
 * cash yet.
 */
export function homeMonthKey(search: string, todayKey: string, firstKey: string | null, withNext = false): string {
  const raw = new URLSearchParams(search).get("month");
  const current = todayKey.slice(0, 7);
  if (raw == null || !MONTH_KEY.test(raw)) return current;
  if (raw > current) return withNext && raw === shiftMonthKey(current, 1) ? raw : current;
  if (firstKey != null && raw < firstKey) return firstKey;
  return raw;
}

/** FLOW-1056: Home's three month states: a closed month, this month, and next month (its forecast). */
export type HomeMonthState = "past" | "current" | "future";

export function homeMonthState(monthKey: string, currentKey: string): HomeMonthState {
  return monthKey < currentKey ? "past" : monthKey > currentKey ? "future" : "current";
}

/**
 * FLOW-1056: the band's arrows. Earlier: the month before, from the books' first month on; next month's earlier
 * is the current month. Later: the month after a past month; on the current month, next month when `withNext`;
 * none on next month.
 */
export function homeMonthSteps(monthKey: string, currentKey: string, firstKey: string | null, withNext: boolean): { earlierKey: string | null; laterKey: string | null } {
  const state = homeMonthState(monthKey, currentKey);
  if (state === "future") return { earlierKey: currentKey, laterKey: null };
  const prevKey = shiftMonthKey(monthKey, -1);
  const earlierKey = firstKey != null && prevKey >= firstKey ? prevKey : null;
  const laterKey = state === "past" || withNext ? shiftMonthKey(monthKey, 1) : null;
  return { earlierKey, laterKey };
}

/** The Home path for a month: "/" for the current month, else "/?month=YYYY-MM"; `preview` is kept. */
export function homeMonthPath(key: string, search: string, currentKey: string): string {
  const params = new URLSearchParams();
  if (key !== currentKey) params.set("month", key);
  const preview = new URLSearchParams(search).get("preview");
  if (preview != null) params.set("preview", preview);
  const query = params.toString();
  return query === "" ? "/" : `/?${query}`;
}

/**
 * A change pill's tone. נכנס going up helps, and יצא going down helps; the opposite hurts.
 * No change, no pill.
 */
export function changeTone(side: "in" | "out", delta: bigint): "helps" | "hurts" | null {
  if (delta === 0n) return null;
  const up = delta > 0n;
  return (side === "in") === up ? "helps" : "hurts";
}

export type DrawerCellState = "selected" | "data" | "next" | "future" | "before";

export type DrawerCell = {
  key: string;
  /** 0 for January. */
  index: number;
  state: DrawerCellState;
  /** The month's net in the base currency; null for a future or a before-the-books month. */
  netMinor: bigint | null;
};

/**
 * The twelve cells of one year in the month drawer. `netByMonth` holds the base-currency net
 * of each month that has data, keyed by YYYY-MM. A month after today is "future"; a month
 * before the books' first month is "before" (both disabled). FLOW-1036: with `withNext`, the
 * month after today is "next": dashed like a month to come, and (FLOW-1056) picked like any month; once
 * picked it is "selected", with no net (its figures are a forecast).
 */
export function drawerCells(
  year: number,
  netByMonth: Record<string, bigint>,
  firstKey: string | null,
  todayKey: string,
  selectedKey: string,
  withNext = false,
): DrawerCell[] {
  const today = todayKey.slice(0, 7);
  const next = withNext ? shiftMonthKey(today, 1) : null;
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${String(year)}-${String(index + 1).padStart(2, "0")}`;
    if (key === selectedKey) return { key, index, state: "selected", netMinor: key === next ? null : netByMonth[key] ?? 0n };
    if (key === next) return { key, index, state: "next", netMinor: null };
    if (key > today) return { key, index, state: "future", netMinor: null };
    if (firstKey != null && key < firstKey) return { key, index, state: "before", netMinor: null };
    return { key, index, state: "data", netMinor: netByMonth[key] ?? 0n };
  });
}

/**
 * Whether a year button can step to `year + delta`: only into a year that has months in [first, current], or
 * (FLOW-1036, `withNext`) the year of next month, so December's drawer reaches January's forecast.
 */
export function canStepYear(year: number, delta: number, firstKey: string | null, todayKey: string, withNext = false): boolean {
  const target = year + delta;
  if (target > Number((withNext ? shiftMonthKey(todayKey.slice(0, 7), 1) : todayKey).slice(0, 4))) return false;
  if (firstKey != null && target < Number(firstKey.slice(0, 4))) return false;
  return true;
}

