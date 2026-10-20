import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { restExpenseNote, restIncomeNote, restMonthsCaption, type RestOfYear } from "../company-year-forecast";
import { allTimeYearRows, yearMonthRows, yearProjectRows, yearRowMeta, type ProjectStatus, type YearRow } from "../company-year-rows";
import { allTimeChart, allTimeSub, allTimeSummaryRows, allTimeTotals, yearChart, yearSub, yearSummaryRows, type CompanyYears, type YearFigures } from "../company-years";
import type { Breakdown } from "@flow/shared";
import type { RentCategory } from "../next-month-chart";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { List } from "../ui/list-row";
import { ForecastCard, MonthChart } from "../ui/month-forecast";
import { NextMonthCardSkeleton, ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { CompanySummaryCard } from "./profit-summary";

/**
 * The company profit page's year and since-the-start views (canvas note spec-years, decision 0200; boards Profit ·
 * 2026 and Profit · מההתחלה): what goes under the period switch and the list under the head. The screen owns the
 * switch, the URL and the reads; this builds the parts from the figures.
 */

export type YearList = "month" | "project";

const YEAR_LISTS: ReadonlyArray<{ value: YearList; label: string }> = [
  { value: "month", label: "לפי חודש" },
  { value: "project", label: "לפי פרויקט" },
];

export type PeriodViewInput = {
  period: "year" | "all";
  data: CompanyYears;
  /** yyyy, the year the year view shows. */
  year: string;
  today: string;
  currency: string;
  /** The rest of this year; null in December or while it is unread. */
  rest: RestOfYear | null;
  restLoading: boolean;
  /** The forecast's reads failed: a quiet line stands where the card would be. */
  restFailed: boolean;
  categories: readonly RentCategory[];
  list: YearList;
  projects: { breakdowns: { income: Breakdown | null; expense: Breakdown | null }; statuses: readonly ProjectStatus[]; pending: boolean; failed: boolean; onRetry: () => void };
  onList: (list: YearList) => void;
  /** A row's tap: the month view, or a year. */
  onOpen: (opens: Exclude<YearRow["opens"], null | { kind: "project" }>) => void;
  projectHref: (projectId: string) => string;
};

export type PeriodView = {
  subtitle: string;
  profit: bigint;
  /** Under the switch: the figure, the summary, the year's forecast card and the chart. */
  head: ReactNode;
  /** The year's chips (the compact bar shows them too); none since the start. */
  chips: ReactNode | null;
  body: ReactNode;
};

function Figure({ minor, currency }: { minor: bigint; currency: string }) {
  return (
    <p className="ui-cp-figure">
      <Amount agorot={minor} currency={currency} size="display" loss={minor < 0n} direction={minor > 0n ? "income" : undefined} />
    </p>
  );
}

function PeriodRow({ row, currency, onOpen, projectHref }: { row: YearRow; currency: string; onOpen: PeriodViewInput["onOpen"]; projectHref: PeriodViewInput["projectHref"] }) {
  const content = (
    <>
      <span className="ui-cp-top">
        <span className="ui-cp-name">{row.title}</span>
        <Amount agorot={row.profitMinor} currency={currency} loss={row.profitMinor < 0n} direction={row.profitMinor > 0n ? "income" : undefined} />
      </span>
      <span className="ui-cp-meta t-caption t-muted">{yearRowMeta(row, currency)}</span>
    </>
  );
  const opens = row.opens;
  return (
    <li className="ui-cp-row">
      {opens == null ? (
        <div className="ui-cp-link">{content}</div>
      ) : opens.kind === "project" ? (
        <Link className="ui-cp-link" to={projectHref(opens.projectId)}>{content}</Link>
      ) : (
        <button type="button" className="ui-cp-link" onClick={() => { onOpen(opens); }}>{content}</button>
      )}
    </li>
  );
}

function rowsList(rows: readonly YearRow[], input: PeriodViewInput, className: string) {
  return (
    <List layout="flat" className={className}>
      {rows.map((row) => <PeriodRow key={row.key} row={row} currency={input.currency} onOpen={input.onOpen} projectHref={input.projectHref} />)}
    </List>
  );
}

/** The year's card, "סוף 2026", in the תזרים צפוי form: from the profit to date, the months left, the year's end. */
function YearForecast({ year, input }: { year: YearFigures; input: PeriodViewInput }) {
  if (input.restLoading) return <DelayedSkeleton><NextMonthCardSkeleton /></DelayedSkeleton>;
  if (input.restFailed) return <p className="ui-cp-fc-failed t-caption t-muted" role="status">לא הצלחנו לטעון את הצפי לסוף השנה.</p>;
  const rest = input.rest;
  if (rest == null || rest.forecasts.every((forecast) => forecast.rows.length === 0)) return null;
  return (
    <ForecastCard
      title={`סוף ${year.year}`}
      kind="profit"
      currency={input.currency}
      start={{ label: "רווח עד היום", minor: year.profitMinor }}
      incomeMinor={rest.incomeMinor}
      expenseMinor={rest.expenseMinor}
      incomeNote={restIncomeNote(rest, input.categories)}
      expenseNote={restExpenseNote(rest)}
      netLabel={`רווח צפוי ל־${year.year}`}
      strong
      signed
      caption={restMonthsCaption(rest)}
    />
  );
}

function yearView(input: PeriodViewInput, year: YearFigures): PeriodView {
  const rest = year.current && !input.restLoading ? input.rest : null;
  const chart = yearChart(year, rest, rest == null ? "" : restMonthsCaption(rest));
  const chips = (
    <div className="ui-cp-chips" role="group" aria-label="סידור">
      {YEAR_LISTS.map((option) => (
        <Chip key={option.value} pressed={input.list === option.value} onClick={() => { input.onList(option.value); }}>{option.label}</Chip>
      ))}
    </div>
  );
  let body: ReactNode;
  if (input.list === "project") {
    const projectRows = yearProjectRows(input.projects.breakdowns, input.currency, input.projects.statuses);
    if (input.projects.pending) body = <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>;
    else if (input.projects.failed) {
      body = (
        <div className="ui-cp-period-list">
          <p className="ui-cp-foot t-caption t-muted" role="status">לא הצלחנו לטעון את הפרויקטים.</p>
          <Button variant="link" aria-label="ניסיון חוזר: הפרויקטים של השנה" onClick={input.projects.onRetry}>ניסיון חוזר</Button>
        </div>
      );
    } else if (projectRows.length === 0) body = <p className="ui-cp-foot ui-cp-period-list t-caption t-muted">אין הכנסות או הוצאות בשנה הזו</p>;
    else body = rowsList(projectRows, input, "ui-cp-list ui-cp-period-list");
  } else {
    body = rowsList(yearMonthRows(year), input, "ui-cp-list ui-cp-period-list");
  }
  return {
    subtitle: yearSub(year, input.today),
    profit: year.profitMinor,
    head: (
      <>
        <Figure minor={year.profitMinor} currency={input.currency} />
        <CompanySummaryCard rows={yearSummaryRows(input.data, year)} currency={input.currency} />
        <div className="ui-fc-block">
          {year.current ? <YearForecast year={year} input={input} /> : null}
          <MonthChart kind="profit" history={chart.history} forecast={chart.forecast} sub={chart.sub} label={chart.label} />
        </div>
      </>
    ),
    chips,
    body,
  };
}

function allTimeView(input: PeriodViewInput): PeriodView {
  const totals = allTimeTotals(input.data);
  const chart = allTimeChart(input.data, input.restLoading ? null : input.rest, input.currency);
  const rows = allTimeYearRows(input.data);
  const count = rows.length === 1 ? "שנה אחת" : rows.length === 2 ? "שנתיים" : `${String(rows.length)} שנים`;
  return {
    subtitle: allTimeSub(input.data, input.today),
    profit: totals.profitMinor,
    head: (
      <>
        <Figure minor={totals.profitMinor} currency={input.currency} />
        <CompanySummaryCard rows={allTimeSummaryRows(input.data)} currency={input.currency} />
        <div className="ui-fc-block">
          <MonthChart kind="profit" title="הכנסות והוצאות לפי שנה" history={chart.months} forecast={null} sub={chart.sub} label={chart.label} />
        </div>
      </>
    ),
    chips: null,
    body: (
      <section className="ui-lines-group" aria-label="לפי שנה">
        <div className="ui-lines-group-head">
          <h2 className="t-section ui-lines-group-title">לפי שנה</h2>
          <span className="t-caption t-muted">{count}</span>
        </div>
        {rowsList(rows, input, "ui-cp-list")}
      </section>
    ),
  };
}

/** The view under the switch for a year or since the start. */
export function periodView(input: PeriodViewInput): PeriodView {
  if (input.period === "all") return allTimeView(input);
  const year = input.data.years.find((row) => row.year === input.year) ?? input.data.years.at(-1);
  if (year == null) return allTimeView(input);
  return yearView(input, year);
}
