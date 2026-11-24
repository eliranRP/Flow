import type { CategoryRow, ForecastOverrideRow } from "@flow/shared";
import { useMemo } from "react";
import { useCompanyCurrencyQuery } from "./company-currency";
import { incomeFactsOf, type IncomeFacts } from "./next-month-chart";
import { useProjectForecast } from "./project-forecast-query";
import type { CategoryHistory, ChargeHint } from "./project-next-edit";
import { applyForecastEdits, nextMonthForecast, nextMonthKey, type NextMonthForecast } from "./project-next-month";
import type { NextMonthSample } from "./project-next-month-query";
import { israelToday } from "./ui/date-math";
import { useCategoriesQuery } from "./use-books";

/** One stable empty list for the charges and categories while the read is out. */
const NONE: never[] = [];

/** What the project page's card, its צפי page, its edit page and its profit page read of one project's month. */
export type ProjectNextMonth = {
  /** The month's forecast in profit terms (cashForecast adds the loans' cash); null until the read is in. */
  forecast: NextMonthForecast | null;
  /** What the card's income note reads of the rows. */
  income: IncomeFacts | null;
  /** FLOW-1079: the month's forecast overrides, what a skipped row's החזרה writes back; null while the read is out. */
  overrides: readonly ForecastOverrideRow[] | null;
  /** yyyy-mm */
  month: string;
  /** yyyy-mm-dd: the day the forecast is from (the sample's, else Israel's today). */
  today: string;
  /** The currency of the figures: the company's for the general costs (0147), else the project's. */
  currency: string;
  /** FLOW-1079: the general costs' page (the overhead project's): a charge with no project is its own. */
  general: boolean;
  /** An edit of the project starts in this month: the צפי page's reset button. */
  edited: boolean;
  /** The edit page's history bars: the six months before this one, and the project's expenses by category. */
  history: CategoryHistory | null;
  /** The edit page's category hints: the project's charges that file to a category. */
  charges: readonly ChargeHint[];
  /** The company's categories (the edit page's category sheet); read only with `withCategories`. */
  categories: readonly CategoryRow[];
  pending: boolean;
  failed: boolean;
  paused: boolean;
  refetch: () => void;
};

/** The forecast a story, a test or the dev fixture describes: the TypeScript builders on the sample's reads (the reference the database's read is held equal to). */
function sampleForecast(sample: NextMonthSample, projectId: string, currency: string, month: string): { forecast: NextMonthForecast; income: IncomeFacts; edited: boolean } {
  const base = nextMonthForecast({
    projectId,
    currency,
    today: sample.today,
    recurring: sample.expected.recurring,
    categoryMonths: sample.categoryMonths,
    loans: sample.loans ?? [],
    categories: sample.categories ?? [],
    month,
  });
  const edits = sample.edits ?? [];
  const forecast = applyForecastEdits(base, edits);
  return { forecast, income: incomeFactsOf(forecast.rows, sample.categories ?? []), edited: edits.some((edit) => edit.start_month === forecast.month) };
}

/**
 * FLOW-1002 (owner, 2026-10-31: "the row should behave the same as a regular project"): a project's forecast for one month, as its
 * צפי page, its edit page, its profit page and its card read it. FLOW-1315: one read, `project_forecast`, whatever the project:
 * the database builds the company's overhead project's page as the general costs (decision 0237: what carries no project and what the
 * overhead project carries, with its edits, the part the company's צפי page shows under כללי) and says so (`general`), in the
 * company's currency; a project of another currency gets its own (`currency` is the one its figures are in). The read waits for
 * `enabled` only, so the card needs one request after get_project. A sample (a story, a test, the dev fixture) is built here from its reads.
 * `withCategories` (the edit page) also reads the company's categories, for its category sheet.
 *
 * While the read is out `forecast` and the data fields are empty and `pending` is true; a failed read is `failed`, its retry `refetch`.
 */
export function useProjectNextMonth(projectId: string, currency: string, sample?: NextMonthSample, enabled = true, forMonth?: string, withCategories = false): ProjectNextMonth {
  const today = sample?.today ?? israelToday();
  // FLOW-1066: any month of the forecast (?month=), next month by default.
  const month = forMonth ?? nextMonthKey(today);
  const live = sample == null && enabled;
  // The database answers in the company's currency unless asked for another, so the read names only a project's own different one
  // (and, while the company's is unknown, none): a project in the company's currency has one key, however early the page starts it.
  const companyCurrency = useCompanyCurrencyQuery(live).data;
  const asked = companyCurrency != null && currency !== companyCurrency ? currency : null;
  const read = useProjectForecast(projectId, month, today, asked, live);
  const categoryRead = useCategoriesQuery(live && withCategories);
  const built = useMemo(() => (sample == null ? null : sampleForecast(sample, projectId, currency, month)), [sample, projectId, currency, month]);
  const answer = read.data ?? null;
  const reads = withCategories ? [read, categoryRead] : [read];
  const refetch = () => {
    for (const item of reads) void item.refetch();
  };
  if (sample != null) {
    return {
      forecast: built?.forecast ?? null,
      income: built?.income ?? null,
      overrides: NONE,
      month,
      today,
      currency,
      general: false,
      edited: built?.edited ?? false,
      history: sample.categoryMonths,
      charges: sample.expected.recurring,
      categories: sample.categories ?? NONE,
      pending: false,
      failed: false,
      paused: false,
      refetch,
    };
  }
  return {
    forecast: answer?.forecast ?? null,
    income: answer?.income ?? null,
    overrides: answer?.overrides ?? null,
    month,
    today,
    currency: answer?.currency ?? currency,
    general: answer?.general ?? false,
    edited: answer?.edited ?? false,
    history: answer?.history ?? null,
    charges: answer?.charges ?? NONE,
    categories: categoryRead.data ?? NONE,
    pending: reads.some((item) => item.isPending),
    failed: reads.some((item) => item.isError),
    paused: reads.some((item) => item.isPaused),
    refetch,
  };
}
