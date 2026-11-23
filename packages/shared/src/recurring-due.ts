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
 * FLOW-1266: the day a charge is due in `month` (yyyy-mm), yyyy-mm-dd: its usual day, capped at the month's last
 * day (private.recurring_due_date).
 */
export function dueDate(month: string, day: number | null | undefined): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const capped = Math.max(1, Math.min(day ?? 1, last));
  return `${month.slice(0, 7)}-${String(capped).padStart(2, "0")}`;
}

/** FLOW-1266: a charge's end date and usual day; a charge is not expected on a due day after the end date. */
export type ChargeEnd = { endsOn?: string | null; typicalDay?: number | null };

/**
 * Whether a charge comes in `month` (yyyy-mm): from its due month, every pace months. A charge that is late
 * (its due month already passed) counts from this month (`thisMonth`, yyyy-mm), as expected_months counts it.
 * A charge with no due month counts from this month. With an end date (FLOW-1266), not after it.
 */
export function dueInMonth(
  nextDue: string | null | undefined,
  pace: RecurringPace | null | undefined,
  month: string,
  thisMonth: string,
  end: ChargeEnd = {},
): boolean {
  const due = nextDue?.slice(0, 7);
  const from = due == null || due < thisMonth ? thisMonth : due;
  const gap = monthIndex(month) - monthIndex(from);
  if (gap < 0 || gap % paceMonths(pace) !== 0) return false;
  return end.endsOn == null || dueDate(month, end.typicalDay) <= end.endsOn;
}
