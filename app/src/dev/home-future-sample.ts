import { companyCashForecast } from "../company-next-month";
import { companyMonthForecast } from "../company-year-forecast";
import type { HomeFuture } from "../screens/home-activity";
import { homeFutureView } from "../screens/home-future-month";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_PROJECTS, NEXT_MONTH_TODAY } from "./home-next-month-sample";

/**
 * FLOW-1056 fixture: Home on a month to come, from the next-month sample (invented names, USD cents). Today is
 * 11/10/2026 there, so the current month is October, next month is November and (FLOW-1066) the forecast's last
 * month is October 2027.
 */
export const FUTURE_CURRENT_KEY = NEXT_MONTH_TODAY.slice(0, 7);
export const FUTURE_MONTH_KEY = "2026-11";
/** FLOW-1066: a month after next, next year: March 2027. */
export const FAR_MONTH_KEY = "2027-03";

const reads = HOME_NEXT_MONTH_SAMPLE.next;

/**
 * The view Home draws for `month` (November by default): `phase` loading or failed draws those states; `empty`
 * expects nothing.
 */
export function sampleHomeFuture(search: string, { phase = "ready", empty = false, month = FUTURE_MONTH_KEY }: { phase?: HomeFuture["phase"]; empty?: boolean; month?: string } = {}): HomeFuture {
  const profit = companyMonthForecast({ currency: "USD", today: NEXT_MONTH_TODAY, recurring: reads.recurring, loans: reads.loans, categories: reads.categories, inputs: reads.inputs }, month);
  const built = companyCashForecast(profit);
  const forecast = empty ? { ...built, rows: [], parts: [], incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n } : built;
  return homeFutureView({
    forecast,
    profitMinor: empty ? 0n : profit.netMinor,
    categories: reads.categories,
    projects: NEXT_MONTH_PROJECTS.projects,
    cash: HOME_NEXT_MONTH_SAMPLE.cash,
    today: NEXT_MONTH_TODAY,
    currency: "USD",
    search,
    loading: phase === "loading",
    failed: phase === "failed",
    offline: false,
    onRetry: () => undefined,
  });
}
