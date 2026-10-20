import type { RecurringPace } from "./forecast.ts";

/**
 * When a recurring charge is due (decision 0175, and 0199 for the month forecast). One rule for every client
 * list of expected charges: the month forecast (תזרים צפוי, the app and the MCP's get_forecast) and next
 * month's project and company forecasts. It is the rule the server's expected_months cells follow, so a list
 * and the totals beside it never disagree.
 */

/** How many months apart a pace's charges come; a missing pace is monthly. */
export function paceMonths(pace: RecurringPace | null | undefined): number {
  if (pace === "2months") return 2;
  if (pace === "quarter") return 3;
  if (pace === "year") return 12;
  return 1;
}

/** A yyyy-mm (or yyyy-mm-dd) key as a count of months, so two keys subtract to the months between them. */
export function monthIndex(key: string): number {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
}

/**
 * Whether a charge comes in `month` (yyyy-mm): from its due month, every pace months. A charge that is late
 * (its due month already passed) counts from this month (`thisMonth`, yyyy-mm), as expected_months counts it.
 * A charge with no due month counts from this month.
 */
export function dueInMonth(nextDue: string | null | undefined, pace: RecurringPace | null | undefined, month: string, thisMonth: string): boolean {
  const due = nextDue?.slice(0, 7);
  const from = due == null || due < thisMonth ? thisMonth : due;
  const gap = monthIndex(month) - monthIndex(from);
  return gap >= 0 && gap % paceMonths(pace) === 0;
}
