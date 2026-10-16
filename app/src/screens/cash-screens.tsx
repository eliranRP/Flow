import { type CashMonths } from "@flow/shared";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  cashMonthKey,
  cashMonthPath,
  cashSummaryRows,
  cashTitle,
  cashYearPath,
  isCashMonthKey,
  shownCashRows,
} from "../cash";
import { anchorOf, monthPeriod, shiftMonthKey, type PeriodChoice } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCashMonthData, useCashYearsQuery, useOpenCashRow } from "../use-cash";
import { Amount } from "../ui/amount";
import { CashRows } from "../ui/cash-rows";
import { israelToday } from "../ui/date-math";
import { MonthStepper } from "../ui/month-stepper";
import { PeriodSwipe } from "../ui/period-swipe";
import { ScreenHeader } from "../ui/screen-header";
import { LinesSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { monthOf } from "./cash-lines-screen";

/**
 * FLOW-413, frame b. An earlier month's cash page (its figure, נכנס, יצא and "רווח ב<month>", as Home
 * shows the current month), and the lines behind one month's נכנס or יצא, or (FLOW-418) the cash
 * profit leaves out. Decision 0168.
 */

/** Dev fixtures pass the month and the sample; the app reads the month from the path. */
export function CashMonthScreen({ sample, monthKey }: { sample?: NonNullable<CashMonths>; monthKey?: string } = {}) {
  const params = useParams();
  const month = monthKey ?? params.month;
  const search = usePreviewSearch();
  if (!isCashMonthKey(month)) return <Navigate to={`/${search}`} replace />;
  return <CashMonthBody monthKey={month} search={search} sample={sample} />;
}

function CashMonthBody({ monthKey, search, sample }: { monthKey: string; search: string; sample?: NonNullable<CashMonths> }) {
  const preview = useHomePreview();
  const open = useOpenCashRow();
  // FLOW-417: a month older than Home's reads its year, and Back returns to that year.
  const { query, recent } = useCashMonthData(monthKey, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const title = cashTitle(monthKey);
  const back = recent ? `/${search}` : cashYearPath(Number(monthKey.slice(0, 4)), search);
  const navigate = useNavigate();
  // FLOW-362 (C15-6): the page steps months, from the books' first month to this one.
  const years = useCashYearsQuery(sample == null);
  const first = sample ? cashMonthKey(sample.months.at(-1)?.month ?? monthKey) : years.data?.first_month ? cashMonthKey(years.data.first_month) : null;
  const opens = (key: string) => first != null && key >= first && key <= israelToday().slice(0, 7);
  const go = (key: string) => {
    void navigate(cashMonthPath(key, search), { replace: true });
  };
  const earlierKey = shiftMonthKey(monthKey, -1);
  const laterKey = shiftMonthKey(monthKey, 1);
  const stepper = (
    <MonthStepper
      earlier={opens(earlierKey) ? cashTitle(earlierKey) : null}
      later={opens(laterKey) ? cashTitle(laterKey) : null}
      onStep={(delta) => {
        go(delta < 0 ? earlierKey : laterKey);
      }}
    />
  );
  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker="תזרים" phase={phase} onRetry={() => { void query.refetch(); }} loading={<LinesSkeleton />} />;
  }
  const data = sample ?? query.data ?? null;
  const month = monthOf(data ?? undefined, monthKey);
  // A month outside the books (after this one) has no page.
  if (data == null || month == null) return <Navigate to={back} replace />;
  const rows = shownCashRows(month, data.base_currency);
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker="תזרים" titleAside={stepper} />
      {/* A sideways swipe on the figure steps the month, as on the profit band (FLOW-336). */}
      <PeriodSwipe
        period={monthPeriod(monthKey)}
        allow={(next: PeriodChoice) => opens(anchorOf(next))}
        onChange={(next) => {
          go(anchorOf(next));
        }}
      >
        <p className="ui-breakdown-total ui-page-pad">
          {rows.map((row) => (
            <span key={row.currency} className="ui-breakdown-total-line">
              <Amount agorot={row.net_minor} currency={row.currency} size="display" loss={row.net_minor < 0n} />
            </span>
          ))}
        </p>
      </PeriodSwipe>
      <CashRows rows={cashSummaryRows(monthKey, rows, search)} onOpen={open} />
    </div>
  );
}

