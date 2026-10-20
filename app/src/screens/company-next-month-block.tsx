import type { ProfitMonths } from "@flow/shared";
import { cashMonthName } from "../cash";
import { companyExpenseNote, companyForecastCaption, companyIncomeNote, type CompanyNextMonth } from "../company-next-month";
import { CHART_MONTHS } from "../month-figures";
import { chartHistory, chartLabel, chartSub, forecastChartMonth, profitMonthFigures, type RentCategory } from "../next-month-chart";
import { shiftMonthKey } from "../period";
import { ForecastCard, MonthChart } from "../ui/month-forecast";
import { NextMonthCardSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";

/**
 * The company's next month (canvas note spec-fcwide, item 2): the shared dashed card with no link (its grey
 * caption says what the sum is made of: "7 פרויקטים וכללי") and the chart of the company's last six profit
 * months with the forecast as its last pair, no link under it. The card hides when nothing is expected; the
 * chart waits for its months and drops the forecast pair when the forecast could not be read.
 */
export function CompanyNextMonthBlock({
  forecast,
  loading,
  months,
  current,
  thisMonthExpense,
  currency,
  categories,
  today,
}: {
  forecast: CompanyNextMonth | null;
  /** The forecast's reads are still out: the card's skeleton holds its place. */
  loading: boolean;
  /** get_profit_months for the company; null while unread or failed. */
  months: NonNullable<ProfitMonths>["months"] | null;
  /** yyyy-mm, the month to date. */
  current: string;
  /** This month's counted expenses so far: the expense caption compares with it. */
  thisMonthExpense: bigint;
  currency: string;
  categories: readonly RentCategory[];
  /** yyyy-mm-dd: the month's name carries a year only when it is not today's. */
  today: string;
}) {
  // Always the six months: the company has no first month to start the window from.
  const history = months == null ? null : chartHistory(current, profitMonthFigures(months, currency), shiftMonthKey(current, 1 - CHART_MONTHS));
  const ahead = forecast == null ? null : forecastChartMonth(forecast);
  return (
    <div className="ui-fc-block">
      {loading ? (
        <DelayedSkeleton><NextMonthCardSkeleton /></DelayedSkeleton>
      ) : forecast == null || forecast.rows.length === 0 ? null : (
        <ForecastCard
          title={cashMonthName(forecast.month, new Date(`${today}T12:00:00Z`))}
          kind="profit"
          currency={currency}
          incomeMinor={forecast.incomeMinor}
          expenseMinor={forecast.expenseMinor}
          incomeNote={companyIncomeNote(forecast, categories)}
          expenseNote={companyExpenseNote(forecast, current, thisMonthExpense, currency)}
          caption={companyForecastCaption(forecast)}
        />
      )}
      {history == null ? null : (
        <MonthChart
          kind="profit"
          history={history.months}
          forecast={loading ? null : ahead}
          sub={chartSub(history, !loading && ahead != null)}
          label={chartLabel(history, loading ? null : ahead, currency, "profit", "הכנסות והוצאות של החברה")}
        />
      )}
    </div>
  );
}
