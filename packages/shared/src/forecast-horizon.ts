/**
 * FLOW-1066 (owner, 2026-11-06: "I want to see the forecast revenue on any future month"; decision 0260): how far
 * ahead the forecast goes. Every month from next month through the same month next year: in November 2026,
 * December 2026 to November 2027. Home, the forecast pages, the flow-mcp reads and company_next_month_inputs
 * (the same 12) all stop at its last month.
 */

/** The months after the current one the forecast covers. */
export const FORECAST_HORIZON_MONTHS = 12;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** yyyy-mm `delta` months from a yyyy-mm (or yyyy-mm-dd) key. */
function shiftMonth(key: string, delta: number): string {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + delta;
  const year = Math.floor(index / 12);
  return `${String(year)}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

/** The horizon's last month (yyyy-mm) for a day or a month (yyyy-mm-dd or yyyy-mm): the same month next year. */
export function forecastLastMonth(today: string): string {
  return shiftMonth(today, FORECAST_HORIZON_MONTHS);
}

/** Every month of the horizon, oldest first: next month to the last one. */
export function forecastMonths(today: string): string[] {
  return Array.from({ length: FORECAST_HORIZON_MONTHS }, (_, index) => shiftMonth(today, index + 1));
}

/** Whether `month` (yyyy-mm) is a month the forecast covers: after `today`'s month, up to the last one. */
export function inForecastHorizon(month: string, today: string): boolean {
  return MONTH_KEY.test(month) && month > today.slice(0, 7) && month <= forecastLastMonth(today);
}
