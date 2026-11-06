import type { ForecastOverrideRow } from "@flow/shared";
import type { CashMonths } from "@flow/shared";
import { useMemo } from "react";
import { cashMonthKey } from "../cash";
import { companyCashForecast, type CompanyNextMonth } from "../company-next-month";
import { useCompanyNextMonth, type CompanyNextMonthSample } from "../company-next-month-query";
import type { RentCategory } from "../next-month-chart";

/**
 * FLOW-990 (board "Next month's forecast on Home and Projects", owner's pick 2026-10-30): the company's next
 * month in cash terms. The one forecast the company profit page builds (useCompanyNextMonth), with each part's
 * loans' principal added (decision 0196). FLOW-1056: Home on next month and the company צפי page read it.
 */
export type CompanyCashNextMonth = {
  /** Null while the reads are out, when one failed, or in a preview. */
  forecast: CompanyNextMonth | null;
  loading: boolean;
  /** FLOW-1000: a read failed (the company צפי page and Home say so). */
  failed: boolean;
  /** FLOW-1000: a read waits for the network. */
  paused: boolean;
  /** FLOW-1000: reads the forecast again. */
  refetch: () => Promise<unknown>;
  categories: readonly RentCategory[];
  /** FLOW-1079: the month's forecast overrides (null without a month, or while read), for a skip's undo. */
  overrides: readonly ForecastOverrideRow[] | null;
  /**
   * FLOW-1066 (owner, 2026-11-06: "Expected profit"): the month's expected profit, the profit-basis net (income
   * less expenses, no loan principal); null with the forecast.
   */
  profitMinor: bigint | null;
};

/** A fixture: the forecast's reads and the cash months, as they would come back (Home on a month to come). */
export type HomeNextMonthSample = { next: CompanyNextMonthSample; cash: NonNullable<CashMonths> };

/** FLOW-1066: `month` is a month of the forecast (next month by default). */
export function useCompanyCashNextMonth(currency: string, today: string, enabled: boolean, sample?: CompanyNextMonthSample, month?: string): CompanyCashNextMonth {
  const next = useCompanyNextMonth(currency, today, enabled, sample, month);
  const forecast = useMemo(() => (next.forecast == null ? null : companyCashForecast(next.forecast)), [next.forecast]);
  return { forecast, loading: next.pending, failed: next.failed, paused: next.paused, refetch: next.refetch, categories: next.categories, profitMinor: next.forecast?.netMinor ?? null, overrides: next.overrides };
}

/**
 * This month's cash out so far in the currency, from cash_months: next month's expense line compares with it.
 * Null while the read is out or failed, so the line never says "מול $0".
 */
export function thisMonthCashOut(cash: NonNullable<CashMonths> | null, today: string, currency: string): bigint | null {
  if (cash == null) return null;
  const month = cash.months.find((row) => cashMonthKey(row.month) === today.slice(0, 7));
  return month?.by_currency.find((row) => row.currency === currency)?.out_minor ?? 0n;
}

/** Nothing to show: no forecast, or one with nothing expected (the project page's card hides the same way). */
export function nothingExpected(forecast: CompanyNextMonth | null): boolean {
  return forecast == null || (forecast.rows.length === 0 && forecast.expenseMinor === 0n);
}
