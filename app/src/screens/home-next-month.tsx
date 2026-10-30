import "../ui/lazy.css";
import type { CashMonths } from "@flow/shared";
import type { CompanyNextMonthSample } from "../company-next-month-query";
import { CHART_MONTHS, cashMonthFigures } from "../month-figures";
import { cashTakeaway, chartHistory, chartLabel, chartSub, forecastChartMonth } from "../next-month-chart";
import { shiftMonthKey } from "../period";
import { useCashMonthsQuery } from "../use-cash";
import { MonthChart } from "../ui/month-forecast";
import { CompanyCashCard, nothingExpected, thisMonthCashOut, useCompanyCashNextMonth } from "./company-cash-next-month";

/** A fixture: the forecast's reads and the six cash months, as they would come back. */
export type HomeNextMonthSample = { next: CompanyNextMonthSample; cash: NonNullable<CashMonths> };

/**
 * FLOW-990 (board HomeNextMonth, concept A): Home's החודש הבא, after the split card on the current month. The
 * company's dashed צפי card, then the chart of its last six cash months with next month dashed, as the project
 * page draws them. The whole section hides when nothing is expected or a read failed. Home loads it in its own
 * chunk, so the forecast and the chart stay out of Home's first load.
 */
export function HomeNextMonth({ today, currency, sample }: { today: string; currency: string; sample?: HomeNextMonthSample }) {
  const next = useCompanyCashNextMonth(currency, today, sample == null, sample?.next);
  const cashRead = useCashMonthsQuery(sample == null, CHART_MONTHS);
  const cash = sample?.cash ?? cashRead.data ?? null;
  // Hidden when nothing is expected or a read failed (the forecast's, or the cash months').
  if ((!next.loading && nothingExpected(next.forecast)) || (sample == null && cashRead.isError)) return null;
  const current = today.slice(0, 7);
  const figures = cash == null ? null : cashMonthFigures(cash, currency);
  // Always the six months, as the company profit page: the company has no first month to start the window from.
  const history = figures == null ? null : chartHistory(current, figures, shiftMonthKey(current, 1 - CHART_MONTHS));
  const ahead = next.forecast == null ? null : forecastChartMonth(next.forecast);
  return (
    <section className="ui-home-next" aria-labelledby="home-next-title">
      <h2 id="home-next-title" className="ui-home-next-title">החודש הבא</h2>
      <div className="ui-fc-block">
        <CompanyCashCard next={next} currency={currency} today={today} thisMonthOut={thisMonthCashOut(cash, today, currency)} />
        {next.loading || history == null ? null : (
          <MonthChart
            kind="cash"
            history={history.months}
            forecast={ahead}
            sub={chartSub(history, ahead != null)}
            label={chartLabel(history, ahead, currency, "cash", "נכנס ויצא של החברה")}
            takeaway={cashTakeaway(history, currency)}
          />
        )}
      </div>
    </section>
  );
}
