import { forecastMonths, inForecastHorizon } from "@flow/shared";
import { useSearchParams } from "react-router-dom";

/**
 * FLOW-1066 (decision 0260): the forecast pages' month. `/forecast/next` and a project's צפי page (and its edit
 * and add pages) take `?month=YYYY-MM`, any month of the forecast (next month to forecastLastMonth); no month,
 * or one outside it, is next month, so the old links keep working. Home's band links here too, so this module
 * stays small (no forecast builder).
 */

/** yyyy-mm, the month after `today`'s (yyyy-mm-dd or yyyy-mm): the forecast's first. */
function nextMonth(today: string): string {
  return forecastMonths(today)[0] ?? today.slice(0, 7);
}

/** The month `?month=` names when it is a month of the forecast, else next month. */
export function forecastMonthOf(search: string, today: string): string {
  const raw = new URLSearchParams(search).get("month");
  return raw != null && inForecastHorizon(raw, today) ? raw : nextMonth(today);
}

/**
 * A forecast page's query: `search` (the preview switch) with `?month=` for a month after next. Next month needs
 * none, so its links stay as they were.
 */
export function forecastMonthSearch(search: string, month: string, today: string): string {
  const params = new URLSearchParams(search);
  params.delete("month");
  if (month !== nextMonth(today)) params.set("month", month);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/** The page's forecast month from the location's `?month=`. */
export function useForecastMonth(today: string): string {
  const [params] = useSearchParams();
  return forecastMonthOf(`?${params.toString()}`, today);
}
