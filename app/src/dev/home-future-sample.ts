import { companyCashForecast, companyNextMonthForecast } from "../company-next-month";
import type { HomeFuture } from "../screens/home-activity";
import { homeFutureView } from "../screens/home-future-month";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_PROJECTS, NEXT_MONTH_TODAY } from "./home-next-month-sample";

/**
 * FLOW-1056 fixture: Home on next month, from the next-month sample (invented names, USD cents). Today is
 * 11/10/2026 there, so the current month is October and next month is November.
 */
export const FUTURE_CURRENT_KEY = NEXT_MONTH_TODAY.slice(0, 7);
export const FUTURE_MONTH_KEY = "2026-11";

const reads = HOME_NEXT_MONTH_SAMPLE.next;

/** The view Home draws for November: `phase` loading or failed draws those states; `empty` expects nothing. */
export function sampleHomeFuture(search: string, { phase = "ready", empty = false }: { phase?: HomeFuture["phase"]; empty?: boolean } = {}): HomeFuture {
  const built = companyCashForecast(companyNextMonthForecast({ currency: "USD", today: NEXT_MONTH_TODAY, recurring: reads.recurring, loans: reads.loans, categories: reads.categories, inputs: reads.inputs }));
  const forecast = empty ? { ...built, rows: [], parts: [], incomeMinor: 0n, expenseMinor: 0n, netMinor: 0n } : built;
  return homeFutureView({
    forecast,
    categories: reads.categories,
    projects: NEXT_MONTH_PROJECTS.projects,
    cash: HOME_NEXT_MONTH_SAMPLE.cash,
    today: NEXT_MONTH_TODAY,
    currency: "USD",
    search,
    hold: false,
    loading: phase === "loading",
    failed: phase === "failed",
    offline: false,
    onRetry: () => undefined,
  });
}
