import type { CashMonths } from "@flow/shared";
import { useMemo } from "react";
import { cashMonthKey, cashMonthName } from "../cash";
import { companyCashForecast, companyExpenseNote, companyForecastCaption, companyIncomeNote, type CompanyNextMonth } from "../company-next-month";
import { useCompanyNextMonth, type CompanyNextMonthSample } from "../company-next-month-query";
import type { RentCategory } from "../next-month-chart";
import { ForecastCard } from "../ui/month-forecast";
import { NextMonthCardSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";

/**
 * FLOW-990 (board "Next month's forecast on Home and Projects", owner's pick 2026-10-30): the company's next
 * month in cash terms, the same card on Home and the Projects tab. The one forecast the company profit page
 * builds (useCompanyNextMonth), with each part's loans' principal added (decision 0196).
 */
export type CompanyCashNextMonth = {
  /** Null while the reads are out, when one failed, or in a preview. */
  forecast: CompanyNextMonth | null;
  loading: boolean;
  categories: readonly RentCategory[];
};

export function useCompanyCashNextMonth(currency: string, today: string, enabled: boolean, sample?: CompanyNextMonthSample): CompanyCashNextMonth {
  const next = useCompanyNextMonth(currency, today, enabled, sample);
  const forecast = useMemo(() => (next.forecast == null ? null : companyCashForecast(next.forecast)), [next.forecast]);
  return { forecast, loading: next.pending, categories: next.categories };
}

/**
 * This month's cash out so far in the currency, from cash_months: the card's expense caption compares with it.
 * Null while the read is out or failed, so the caption never says "מול $0".
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

/**
 * The dashed card with no link: the month and its צפי tag, צפוי להיכנס and צפוי לצאת, תזרים צפוי, and the grey
 * caption of what the sum covers ("4 פרויקטים וכללי"). Its skeleton while the reads are out; nothing when
 * nothing is expected or a read failed.
 */
export function CompanyCashCard({
  next,
  currency,
  today,
  thisMonthOut,
}: {
  next: CompanyCashNextMonth;
  currency: string;
  /** yyyy-mm-dd: the month's name carries a year only when it is not today's. */
  today: string;
  /** This month's cash out so far, in the currency: the expense caption compares with it; null while unknown. */
  thisMonthOut: bigint | null;
}) {
  if (next.loading) return <DelayedSkeleton><NextMonthCardSkeleton /></DelayedSkeleton>;
  const forecast = next.forecast;
  if (forecast == null || nothingExpected(forecast)) return null;
  return (
    <ForecastCard
      title={cashMonthName(forecast.month, new Date(`${today}T12:00:00Z`))}
      kind="cash"
      currency={currency}
      incomeMinor={forecast.incomeMinor}
      expenseMinor={forecast.expenseMinor}
      incomeNote={companyIncomeNote(forecast, next.categories)}
      expenseNote={thisMonthOut == null ? "" : companyExpenseNote(forecast, today.slice(0, 7), thisMonthOut, currency)}
      caption={companyForecastCaption(forecast)}
    />
  );
}
