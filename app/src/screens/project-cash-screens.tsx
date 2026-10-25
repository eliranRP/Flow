import { formatAmountText, type CashMonths, type ProjectDetail } from "@flow/shared";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  cashMonthName,
  cashMonthKey,
  cashTitle,
  shownCashRows,
} from "../cash";
import { withPeriodSearch } from "../project-period";
import { cashMonthFigures } from "../month-figures";
import {
  PROJECT_CASH_MONTHS,
  projectCashSummaryRows,
} from "../project-cash";
import type { NextMonthForecast } from "../project-next-month";
import { BackButton } from "../ui/back";
import { Amount } from "../ui/amount";
import { ProjectEmptyCard, ProjectProfitCard } from "./project-page-cards";
import { NextMonthBlock } from "./next-month-block";
import { FocusTitle } from "../ui/focus-title";
import { BannerRows, type BannerRow } from "../ui/banner";
import { List, ListRow } from "../ui/list-row";
import { InvestmentSummary } from "../ui/investment-card";
import { useScrolledPast } from "../ui/screen-header";
import { CompactBar } from "../ui/compact-bar";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { TopBand, usePageAtEnd } from "../ui/top-band";
import { israelToday } from "../ui/date-math";
import { loansFigure } from "./project-overview";
import type { RentCategory } from "../next-month-chart";
import type { ProjectInvestment } from "./project-investment-data";

type Project = NonNullable<ProjectDetail>;

/** What the project page's next-month block reads: the forecast, whether it is still loading, its currency. */
export type NextMonthCash = {
  forecast: NextMonthForecast | null;
  loading: boolean;
  currency: string;
  categories: readonly RentCategory[];
  /** yyyy-mm-dd, the forecast's today. */
  today: string;
};

/**
 * FLOW-419 (owner's option A "Like Home", decision 0176). The project page is the project's cash,
 * as Home is the company's: this month's תזרים, נכנס, יצא and רווח החודש, one row for השקעה
 * והלוואות, then next month's forecast card and the month chart (canvas note spec-fcwide). נכנס and יצא
 * open the project's month page.
 */

/** השקעה והלוואות: הון עצמי בנכס when known, else the loans; null with neither (the row hides). */
export function investmentLoansRow(data: ProjectInvestment, project: Project): { hint?: string; figure?: string } | null {
  const figures = data.isOverhead ? null : data.figures;
  if (figures?.currentEquityMinor != null) {
    return { hint: "הון עצמי בנכס", figure: formatAmountText(figures.currentEquityMinor, figures.currency) };
  }
  const loans = loansFigure(project);
  if (loans != null) return { hint: loans };
  const entered = figures != null
    && (figures.purchaseMinor != null || figures.valueMinor != null || figures.arvMinor != null || figures.rehabMinor !== 0n);
  return entered ? {} : null;
}

export function ProjectCashOverview({
  project,
  data,
  search,
  investmentData,
  investmentHref,
  stateLine,
  menu,
  attention = [],
  sinceProfit = null,
  firstMonth = null,
  fresh = false,
  budget,
  budgetAdd,
  nextMonth = null,
  example,
  now,
}: {
  project: Project;
  /** Null while the cash read is still out: the band paints the project's name from its own read. */
  data: NonNullable<CashMonths> | null;
  search: string;
  investmentData: ProjectInvestment;
  investmentHref: string;
  /** The line under the name for a state other than active ("הסתיים"). */
  stateLine: string | null;
  menu: ReactNode;
  /** Home's attention rows for this project: its late bills and income, and its changed charges. */
  attention?: BannerRow[];
  /** The project's profit over its whole life, per currency (null while unread). */
  sinceProfit?: { currency: string; minor: bigint }[] | null;
  /** The month the project began ("YYYY-MM"), from its row on the Projects list; null while unread. */
  firstMonth?: string | null;
  /** A project with no line, invoice or month yet: the profit rows give way to the empty card. */
  fresh?: boolean;
  /** FLOW-445: the budget card, when the project has a budget (the edit sheet lives with the page). */
  budget?: ReactNode;
  /** The quiet "+ הוספת תקציב" a project with no budget shows after its profit rows. */
  budgetAdd?: ReactNode;
  /** Next month's forecast (the צפי page's) in its currency, for the card and the chart's last pair. */
  nextMonth?: NextMonthCash | null;
  example?: ReactNode;
  /** Stories and tests pin the month names. */
  now?: Date;
}) {
  const month = data?.months[0];
  const key = month == null ? null : cashMonthKey(month.month);
  const rows = data == null ? [] : shownCashRows(month, data.base_currency);
  const investment = investmentLoansRow(investmentData, project);
  // FLOW-445: the summary card shows for a property once its purchase or value is entered. A project
  // whose only entry is an open loan keeps the FLOW-419 row, which names the loan.
  const figures = investmentData.figures;
  const summaryFigures = figures != null && !investmentData.isOverhead
    && (figures.purchaseMinor != null || figures.valueMinor != null || figures.arvMinor != null)
    ? figures
    : null;
  const summary = summaryFigures != null;
  // FLOW-445: once the figure scrolls under the band, the compact bar slides down: Back, "−$X • name", ⋯.
  const [titleEnd, setTitleEnd] = useState<HTMLSpanElement | null>(null);
  // A page too short to scroll the mark under the bar shows it at its bottom. A taller page passes the
  // mark before its bottom, so the mark alone decides there.
  const markPast = useScrolledPast(titleEnd, true);
  const atEnd = usePageAtEnd();
  const past = markPast || atEnd;
  const first = rows[0];
  // FLOW-445: נכנס and יצא sit in the band on one line; the month's profit and the rest stay in the list.
  const summaryRows = key == null ? [] : projectCashSummaryRows(project.id, key, rows, search, now);
  const bandRows = summaryRows.filter((row) => row.id === "in" || row.id === "out");
  // The read holds the last PROJECT_CASH_MONTHS months: a project younger than that began in its oldest one.
  const oldest = data == null ? undefined : data.months[data.months.length - 1];
  const sinceHint = firstMonth != null
    ? `מאז ${cashMonthName(firstMonth, new Date(0))}`
    : oldest == null || data == null || data.months.length >= PROJECT_CASH_MONTHS
      ? "כל התקופה עד היום"
      : `מאז ${cashMonthName(cashMonthKey(oldest.month), new Date(0))}`;
  const profitRow = summaryRows.find((row) => row.id === "profit");
  const keptRow = summaryRows.find((row) => row.id === "kept");
  return (
    <div className="ui-project-cash ui-project-page flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        example={example}
        leading={<BackButton fallback={`/projects${search}`} text="פרויקטים" onBand />}
        trailing={menu}
        heroClassName="ui-band-hero-project"
        hero={
          <>
            <FocusTitle className="t-title">{project.name}</FocusTitle>
            {stateLine == null ? null : <p className="t-line2">{stateLine}</p>}
            <p className="ui-band-label t-line2">{key == null ? "תזרים" : `${cashTitle(key, now)}${key === israelToday(now).slice(0, 7) ? " · עד היום" : ""}`}</p>
            {data == null ? (
              <Skeleton tone="band" className="ui-skel-project-num" />
            ) : (
              <div className="ui-project-profits t-detail">
                {rows.map((row, index) => (
                  <p key={row.currency}>
                    {/* As on Home: the band's figure is whole, short from 100K, and steps down until it fits. */}
                    <Amount agorot={row.net_minor} currency={row.currency} loss={row.net_minor < 0n} size={index > 0 ? "display" : "hero"} compact />
                  </p>
                ))}
              </div>
            )}
            {bandRows.length === 0 ? null : (
              <div className="ui-project-band-pair">
                {bandRows.map((row) => (
                  <Link key={row.id} to={row.href ?? "#"} className="ui-band-row-link m-press" aria-label={row.name}>
                    <span className="ui-band-row-label">{row.id === "in" ? "נכנס" : "יצא"}</span>
                    <span className="ui-band-row-amount">
                      {row.amounts.map((amount) => (
                        <Amount key={amount.currency} agorot={amount.minor} currency={amount.currency} presentation="detail" size="list" />
                      ))}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <span ref={setTitleEnd} className="ui-compact-mark" aria-hidden="true" />
          </>
        }
      />
      <CompactBar
        title={project.name}
        figureFirst
        figure={first == null ? undefined : <Amount agorot={first.net_minor} currency={first.currency} loss={first.net_minor < 0n} presentation="detail" />}
        backTo={`/projects${search}`}
        size="detail"
        shown={past}
        actions={menu}
      />
      {data == null ? <ListSkeleton /> : null}
      <div className="ui-project-stack">
        {/* The board puts the rows that need a hand first: its pending approvals, late bills and changed charges. */}
        <BannerRows rows={attention} />
        {budget}
        {profitRow == null || fresh ? null : (
          <ProjectProfitCard
            monthName={cashMonthName(key ?? "", now)}
            monthLabel={profitRow.name}
            month={profitRow.amounts}
            since={sinceProfit}
            sinceHint={sinceHint}
            monthHref={profitRow.href ?? "#"}
            sinceHref={`/projects/${project.id}/profit${withPeriodSearch(search, { kind: "all", from: null, to: null })}`}
            extra={keptRow}
          />
        )}
        {summary ? null : budgetAdd}
        {fresh ? <ProjectEmptyCard /> : null}
        {data == null || key == null || fresh || nextMonth == null ? null : (
          <NextMonthBlock
            forecast={nextMonth.forecast}
            loading={nextMonth.loading}
            current={key}
            figures={cashMonthFigures(data, nextMonth.currency)}
            firstMonth={firstMonth}
            currency={nextMonth.currency}
            kind="cash"
            cardHref={`/projects/${project.id}/profit/next${search}`}
            categories={nextMonth.categories}
            today={nextMonth.today}
            chartLink={{ href: `/projects/${project.id}/profit${withPeriodSearch(search, { kind: "all", from: null, to: null })}`, text: "רווח לפי חודש" }}
          />
        )}
        {/* The owner's ask (20/10): the investment and loans card comes last, under the forecast and the chart. */}
        {summaryFigures == null ? null : <InvestmentSummary figures={summaryFigures} href={investmentHref} />}
        {investment == null || summary ? null : (
          <List className="ui-project-cash-more">
            <ListRow
              variant="item"
              title="השקעה והלוואות"
              hint={investment.hint}
              meta={investment.figure == null ? undefined : <bdi className="ui-num ui-project-row-figure" dir="ltr">{investment.figure}</bdi>}
              href={investmentHref}
              chevron
            />
          </List>
        )}
      </div>
    </div>
  );
}
