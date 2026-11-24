import type { CashMonths, ForecastOverrideRow } from "@flow/shared";
import { useMemo } from "react";
import { cashMonthKey } from "../cash";
import { useCompanyMonthRows } from "../company-forecast-query";
import { companyCashForecast, type CompanyNextMonth } from "../company-next-month";
import type { CompanyNextMonthSample } from "../company-next-month-query";
import type { IncomeFacts } from "../next-month-chart";
import { nextMonthKey } from "../project-next-month";

/**
 * FLOW-990 (board "Next month's forecast on Home and Projects", owner's pick 2026-10-30): the company's next
 * month in cash terms: each part's loans' principal added (decision 0196). FLOW-1056: Home on next month and the
 * company צפי page read it. FLOW-1308: from one read, `company_forecast` with 'rows' (useCompanyMonthRows), which the
 * database builds; company-forecast-map.ts gives it the shape the TypeScript builders gave.
 */
export type CompanyCashNextMonth = {
  /** Null while the read is out, when it failed, or in a preview. */
  forecast: CompanyNextMonth | null;
  /** The same month in profit terms (the parts' rows and totals before the loans' cash), which a page draws its skips on. */
  profit: CompanyNextMonth | null;
  loading: boolean;
  /** FLOW-1000: a read failed (the company צפי page and Home say so). */
  failed: boolean;
  /** FLOW-1000: a read waits for the network. */
  paused: boolean;
  /** FLOW-1000: reads the forecast again. */
  refetch: () => Promise<unknown>;
  /** What the income note counts (companyIncomeNoteOfFacts); null with the forecast. */
  incomeFacts: IncomeFacts | null;
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

/** FLOW-1066: `month` is a month of the forecast (next month by default). FLOW-1202: `withOverrides` reads the month's override rows, for a page that can skip its rows. */
export function useCompanyCashNextMonth(today: string, enabled: boolean, month?: string, withOverrides = false): CompanyCashNextMonth {
  const read = useCompanyMonthRows(today, month ?? nextMonthKey(today), enabled, withOverrides);
  const profit = read.answer?.forecast ?? null;
  const forecast = useMemo(() => (profit == null ? null : companyCashForecast(profit)), [profit]);
  return { forecast, profit, loading: read.pending, failed: read.failed, paused: read.paused, refetch: read.refetch, incomeFacts: read.answer?.months[0]?.income ?? null, profitMinor: profit?.netMinor ?? null, overrides: read.overrides };
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
