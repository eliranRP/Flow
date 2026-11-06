// FLOW-364: Home's month logic, with no React. Amounts are bigint minor units, months are
// YYYY-MM keys and days are the Israel-local date (YYYY-MM-DD) that israelToday() returns.

import { forecastLastMonth } from "@flow/shared";
import { shiftMonthKey } from "./period";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month Home shows: `?month=` clamped to [first, current], or (FLOW-1056, FLOW-1066: `withForecast`) to the
 * forecast's last month (forecastLastMonth, 12 months ahead). Anything else, or no month, is the current month.
 * `firstKey` is null when the books hold no cash yet.
 */
export function homeMonthKey(search: string, todayKey: string, firstKey: string | null, withForecast = false): string {
  const raw = new URLSearchParams(search).get("month");
  const current = todayKey.slice(0, 7);
  if (raw == null || !MONTH_KEY.test(raw)) return current;
  if (raw > current) {
    if (!withForecast) return current;
    const last = forecastLastMonth(current);
    return raw > last ? last : raw;
  }
  if (firstKey != null && raw < firstKey) return firstKey;
  return raw;
}

/** FLOW-1056: Home's three month states: a closed month, this month, and a month to come (its forecast). */
export type HomeMonthState = "past" | "current" | "future";

export function homeMonthState(monthKey: string, currentKey: string): HomeMonthState {
  return monthKey < currentKey ? "past" : monthKey > currentKey ? "future" : "current";
}

/**
 * FLOW-1056, FLOW-1066: the band's arrows. Earlier: the month before, from the books' first month on; a future
 * month's earlier is always the month before it (next month's is the current month). Later: the month after, up
 * to the forecast's last month with `withForecast`, else up to the current month.
 */
export function homeMonthSteps(monthKey: string, currentKey: string, firstKey: string | null, withForecast: boolean): { earlierKey: string | null; laterKey: string | null } {
  const future = homeMonthState(monthKey, currentKey) === "future";
  const prevKey = shiftMonthKey(monthKey, -1);
  const earlierKey = future || firstKey == null || prevKey >= firstKey ? prevKey : null;
  const nextKey = shiftMonthKey(monthKey, 1);
  const lastKey = withForecast ? forecastLastMonth(currentKey) : currentKey;
  return { earlierKey, laterKey: nextKey <= lastKey ? nextKey : null };
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

export type DrawerCellState = "selected" | "data" | "forecast" | "future" | "before";

export type DrawerCell = {
  key: string;
  /** 0 for January. */
  index: number;
  state: DrawerCellState;
  /** The month's net in the base currency; null for a forecast, a future or a before-the-books month. */
  netMinor: bigint | null;
};

/**
 * The twelve cells of one year in the month drawer. `netByMonth` holds the base-currency net of each month that
 * has data, keyed by YYYY-MM. A month before the books' first month is "before" and a month after today is
 * "future" (both disabled). FLOW-1036, FLOW-1066: with `withForecast`, every month of the forecast (next month to
 * forecastLastMonth) is "forecast": dashed like a month to come, and (FLOW-1056) picked like any month; once
 * picked it is "selected", with no net (its figures are a forecast). Only a month past it stays "future".
 */
export function drawerCells(
  year: number,
  netByMonth: Record<string, bigint>,
  firstKey: string | null,
  todayKey: string,
  selectedKey: string,
  withForecast = false,
): DrawerCell[] {
  const today = todayKey.slice(0, 7);
  const last = withForecast ? forecastLastMonth(today) : today;
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${String(year)}-${String(index + 1).padStart(2, "0")}`;
    const forecast = key > today && key <= last;
    if (key === selectedKey) return { key, index, state: "selected", netMinor: forecast ? null : netByMonth[key] ?? 0n };
    if (forecast) return { key, index, state: "forecast", netMinor: null };
    if (key > today) return { key, index, state: "future", netMinor: null };
    if (firstKey != null && key < firstKey) return { key, index, state: "before", netMinor: null };
    return { key, index, state: "data", netMinor: netByMonth[key] ?? 0n };
  });
}

/**
 * Whether a year button can step to `year + delta`: only into a year that has months in [first, current], or
 * (FLOW-1036, FLOW-1066: `withForecast`) up to the year of the forecast's last month, so the drawer reaches next
 * year's forecast.
 */
export function canStepYear(year: number, delta: number, firstKey: string | null, todayKey: string, withForecast = false): boolean {
  const target = year + delta;
  if (target > Number((withForecast ? forecastLastMonth(todayKey.slice(0, 7)) : todayKey).slice(0, 4))) return false;
  if (firstKey != null && target < Number(firstKey.slice(0, 4))) return false;
  return true;
}
