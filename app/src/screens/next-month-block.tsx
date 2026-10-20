import { chartHistory, chartLabel, chartSub, expenseNote, forecastChartMonth, incomeNote, type RentCategory } from "../next-month-chart";
import { cashMonthName } from "../cash";
import type { MonthFigures } from "../month-figures";
import type { NextMonthForecast } from "../project-next-month";
import { ForecastCard, MonthChart } from "../ui/month-forecast";
import { NextMonthCardSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";

/**
 * A project's next month (canvas note spec-fcwide), as its profit page (לפי חודש) and its project page show
 * it: the dashed forecast card, then the chart of the page's own months with the forecast as its last pair.
 * The forecast is the one the צפי page shows (useNextMonthForecast): on the profit page as it is, on the project
 * page in cash terms (cashForecast: the loans' principal added, decision 0196); the history is the page's
 * (profit months or cash months). The card hides when nothing is expected next month; the chart waits for its
 * history.
 */
export function NextMonthBlock({
  forecast,
  loading,
  current,
  figures,
  firstMonth,
  currency,
  netLabel,
  cardHref,
  categories,
  chartLink,
  today,
}: {
  forecast: NextMonthForecast | null;
  /** The forecast's reads are still out: the card's skeleton holds its place, and the chart waits. */
  loading: boolean;
  /** yyyy-mm, the month to date; null while the history is unread. */
  current: string | null;
  figures: ReadonlyMap<string, MonthFigures>;
  /** yyyy-mm, the project's first month when known. */
  firstMonth: string | null;
  currency: string;
  netLabel: string;
  cardHref: string;
  /** The company's categories, to name recurring rent in the income caption. */
  categories: readonly RentCategory[];
  chartLink?: { href: string; text: string };
  /** yyyy-mm-dd, the forecast's today: the month's name carries a year only when it is not today's. */
  today: string;
}) {
  const history = current == null ? null : chartHistory(current, figures, firstMonth);
  const ahead = forecast == null ? null : forecastChartMonth(forecast);
  return (
    <div className="ui-fc-block">
      {loading ? (
        <DelayedSkeleton><NextMonthCardSkeleton /></DelayedSkeleton>
      ) : forecast == null || (forecast.rows.length === 0 && forecast.expenseMinor === 0n) ? null : (
        <ForecastCard
          monthName={cashMonthName(forecast.month, new Date(`${today}T12:00:00Z`))}
          currency={currency}
          incomeMinor={forecast.incomeMinor}
          expenseMinor={forecast.expenseMinor}
          incomeNote={incomeNote(forecast, categories)}
          expenseNote={expenseNote(forecast, history ?? { months: [], fromStart: false }, currency)}
          netLabel={netLabel}
          href={cardHref}
        />
      )}
      {loading || history == null ? null : (
        <MonthChart
          history={history.months}
          forecast={ahead}
          sub={chartSub(history, ahead != null)}
          label={chartLabel(history, ahead, currency)}
          link={chartLink}
        />
      )}
    </div>
  );
}
