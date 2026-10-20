import { formatAmountText } from "@flow/shared";
import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";
import { lineDayTitle, lineInitials } from "../cash-lines-groups";
import { useCompanyCurrency } from "../company-currency";
import { homeMonthKey, homeMonthPath } from "../home-month";
import { useOverheadProject, type OverheadProject } from "../project-cash";
import { customRange, monthPeriod } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { HEBREW_MONTHS, israelToday } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { Chip } from "../ui/chip";
import { List, ListRow } from "../ui/list-row";
import type { ScreenPhase } from "../ui/screen-phase";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitRowsSkeleton, ProfitSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { ScreenState } from "../ui/screen-state";
import { rowSource } from "../ui/line-marks";
import { BASIS_PROFIT_COPY, basisChoiceLabel } from "../ui/company-choices";
import { buildProfitModel, useCompanyProfitRead, type ProfitInputs, type ProfitLine, type ProfitModel } from "../use-company-profit";
import { byDateThenSize, bySizeOnly, companyCategoryGroups, companySummaryRows } from "../company-profit-rows";
import { useCompanyNextMonth, useCompanyProfitMonths, type CompanyNextMonthSample } from "../company-next-month-query";
import { companyYears } from "../company-years";
import { useCompanyYearProjects, useCompanyYears, type CompanyYearsSample } from "../company-years-query";
import { SegmentedControl } from "../ui/segmented-control";
import { periodView, type PeriodView, type YearList } from "./company-profit-period";
import { CompanyBasisSheet } from "./company-basis-sheet";
import { countWord, ProfitCategories } from "./profit-categories";
import { CompanyNextMonthBlock } from "./company-next-month-block";
import { CompanySummaryCard } from "./profit-summary";
import { useBlockedPreview } from "./screen-shared";

/**
 * A fixture: the reads' inputs for the page, plus the day heads' today, the month it shows and the company's overhead
 * project (none when omitted).
 */
export type CompanyProfitSample = ProfitInputs & { today: string; monthKey: string; overhead?: OverheadProject | null; openFirst?: boolean; sheetOpen?: boolean; next?: CompanyNextMonthSample; years?: CompanyYearsSample };

/** The period switch (canvas note spec-years): the month, a year or since the start, in the URL (`?period=`). */
type Period = "month" | "year" | "all";

function periodOf(value: string | null): Period {
  return value === "year" || value === "all" ? value : "month";
}

/** The year the year view shows (`?year=`, this year when absent or later). */
function yearOf(value: string | null, currentYear: string): string {
  return value != null && /^\d{4}$/.test(value) && value < currentYear ? value : currentYear;
}

const ORDERS = [
  { value: "project", label: "לפי פרויקט" },
  { value: "category", label: "לפי קטגוריה" },
  { value: "date", label: "לפי תאריך" },
  { value: "amount", label: "לפי סכום" },
] as const;
type Order = (typeof ORDERS)[number]["value"];

/** The order in the URL (`?by=`). Project is the absent value. */
function orderOf(value: string | null): Order {
  return value === "category" || value === "date" || value === "amount" ? value : "project";
}

/** A signed figure as text: a plus on money in, a minus on money out (or a loss). */
function signedText(minor: bigint, currency: string): string {
  if (minor === 0n) return formatAmountText(0n, currency);
  return minor < 0n ? `−${formatAmountText(-minor, currency)}` : `+${formatAmountText(minor, currency)}`;
}

/** `dd/mm` of an ISO date. */
function dayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** A project's page with its `from` back to this page, keeping the preview flag. */
function projectProfitPath(projectId: string, search: string): string {
  return `/projects/${projectId}/profit?from=profit${search === "" ? "" : `&${search.slice(1)}`}`;
}

/**
 * The company's profit page (FLOW-140c1, board Profit and ProfitBasis): the month's profit with income
 * and counted expenses, the year to date, then the rows in the order `?by=` picks (project, category,
 * date or amount), and the basis sheet. The period switch under the title (FLOW-145) turns the page to this
 * year or a past one (`?period=year&year=`, its list by month or `&list=project`) or since the start
 * (`?period=all`). `sample` is the dev fixture; otherwise the page reads the books.
 */
export function CompanyProfitScreen({ sample }: { sample?: CompanyProfitSample } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const companyCurrency = useCompanyCurrency();
  const by = orderOf(params.get("by"));
  const today = sample?.today ?? israelToday();
  const currentKey = today.slice(0, 7);
  const currentYear = today.slice(0, 4);
  const period = periodOf(params.get("period"));
  const askedYear = yearOf(params.get("year"), currentYear);
  const yearList: YearList = params.get("list") === "project" ? "project" : "month";
  // Home's ?month= picks an earlier month; its year to date then ends with that month.
  const monthKey = sample?.monthKey ?? homeMonthKey(location.search, today, null);
  const year = monthKey.slice(0, 4);
  const month = monthPeriod(monthKey);
  // The overhead project (owner 20/10): the general costs' row takes its name and opens it, in both views.
  const liveOverhead = useOverheadProject(sample == null);
  const overhead = sample == null ? liveOverhead : sample.overhead ?? null;
  const live = useCompanyProfitRead({
    enabled: sample == null,
    month,
    ytd: customRange(`${year}-01-01`, month.to ?? today),
    currency: companyCurrency,
    linesOn: by !== "project",
    overhead,
  });
  const model: ProfitModel | null = sample ? buildProfitModel(sample, overhead ?? null) : live.model;
  const onCurrent = monthKey === currentKey;
  const long = period !== "month";
  const years = useCompanyYears(today, long, sample?.years);
  const yearsData = years.months == null ? null : companyYears(years.months, sample?.currency ?? companyCurrency, today);
  // A year with no data (before the first counted line, past the read's twenty years, or not a year at all) shows
  // this year, and the switch says so.
  const viewYear = yearsData?.years.some((row) => row.year === askedYear) === true ? askedYear : currentYear;
  // Next month (the current month's card), and the rest of the year for this year's view and since the start, from
  // the same reads; a past year or an earlier month reads none of them.
  const forecastYear = yearsData == null ? askedYear : viewYear;
  const wantsForecast = period === "month" ? onCurrent : period === "all" || forecastYear === currentYear;
  const next = useCompanyNextMonth(sample?.currency ?? companyCurrency, today, wantsForecast, sample?.next);
  const chartMonths = useCompanyProfitMonths(today, onCurrent && !long, sample?.next);
  const yearProjects = useCompanyYearProjects(viewYear, today, period === "year" && yearList === "project", sample?.years);
  const failed = live.failed || (long && years.failed);
  const waiting = model == null;
  const phase: ScreenPhase = sample != null ? { kind: "ready" } : preview !== "off" ? screenPhase(preview) : failed ? { kind: "error", offline: !onlineManager.isOnline() } : waiting ? { kind: "loading" } : { kind: "ready" };
  const [sheetState, setSheetOpen] = useState<boolean | undefined>(undefined);
  const basisRef = useRef<HTMLButtonElement>(null);
  const back = homeMonthPath(monthKey, search, currentKey);
  if (phase.kind !== "ready" || model == null) {
    // The board's loading frame names the month in the title: the stacked header's own bar, Back labelled בית.
    const loadingTitle = period === "month" ? `רווח ${HEBREW_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey}` : "רווח";
    return <ScreenState stacked headerClassName="ui-state-header" title={phase.kind === "loading" ? loadingTitle : "רווח"} kicker="בית" backTo={back} phase={phase} onRetry={() => { live.refetch(); years.refetch(); }} loading={<ProfitSkeleton />} />;
  }
  const currency = model.currency;
  const sheetOpen = sheetState ?? sample?.sheetOpen === true;
  /** Sets (or, with null, drops) query parameters in place: the page keeps its choices in the URL. */
  const setParams = (changes: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) nextParams.delete(key);
      else nextParams.set(key, value);
    }
    const text = nextParams.toString();
    void navigate({ pathname: location.pathname, search: text === "" ? "" : `?${text}` }, { replace: true });
  };
  const setBy = (next: Order) => { setParams({ by: next === "project" ? null : next }); };
  const pickPeriod = (next: Period) => {
    if (next === period) return;
    setParams({ period: next === "month" ? null : next, year: null, list: null });
  };
  const monthName = HEBREW_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey;
  const periodSwitch = (
    <div className="ui-cp-period ui-period-switch">
      <SegmentedControl<Period>
        label="תקופה"
        showLabel={false}
        radius="input"
        value={period}
        onChange={pickPeriod}
        options={[{ value: "month", label: monthName }, { value: "year", label: period === "year" ? viewYear : currentYear, numeric: true }, { value: "all", label: "מההתחלה" }]}
      />
    </div>
  );
  const longView: PeriodView | null = !long || yearsData == null ? null : periodView({
    period: period === "all" ? "all" : "year",
    data: yearsData,
    year: viewYear,
    today,
    currency,
    rest: next.rest,
    restLoading: next.pending,
    restFailed: next.failed,
    categories: next.categories,
    list: yearList,
    projects: { breakdowns: yearProjects.breakdowns, statuses: yearProjects.statuses, overhead: overhead ?? null, pending: yearProjects.pending, failed: yearProjects.failed, onRetry: yearProjects.refetch },
    onList: (list) => { setParams({ list: list === "month" ? null : list }); },
    // This month's row opens the month view on this month; a year's row opens that year.
    onOpen: (opens) => { setParams(opens.kind === "month" ? { period: null, year: null, list: null, month: null } : { period: "year", year: opens.year === currentYear ? null : opens.year, list: null }); },
    projectHref: (projectId) => projectProfitPath(projectId, search),
  });
  const chips = (
    <div className="ui-cp-chips" role="group" aria-label="סידור">
      {ORDERS.map((option) => (
        <Chip key={option.value} pressed={by === option.value} onClick={() => { setBy(option.value); }}>{option.label}</Chip>
      ))}
    </div>
  );
  const basisFooter = (
    <>
      <p className="ui-cp-foot t-caption t-muted">לא נספר ברווח: קנייה ושיפוץ של נכס, קרן של הלוואות, הון בעלים והעברות בין חשבונות.</p>
      <button type="button" ref={basisRef} className="ui-cp-basis" onClick={() => { setSheetOpen(true); }}>
        נספר לפי {basisChoiceLabel(model.basis)} · <span className="ui-cp-change">שינוי</span>
      </button>
      <CompanyBasisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        basis={model.basis}
        blocked={() => blocked(sample != null ? "empty" : undefined)}
        returnFocusRef={basisRef}
        copy={BASIS_PROFIT_COPY}
      />
    </>
  );
  if (long && longView == null) {
    // The years' read is out: the switch stays, a skeleton holds the content's place.
    return (
      <div className="ui-cp-screen">
        <ScreenHeader layout="stacked" title="רווח" backTo={back} backText="בית" below={<div className="ui-cp-head">{periodSwitch}</div>} />
        <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>
      </div>
    );
  }
  if (longView != null) {
    return (
      <div className="ui-cp-screen">
        <ScreenHeader
          layout="stacked"
          title="רווח"
          backTo={back}
          backText="בית"
          subtitle={longView.subtitle}
          compactFigure={signedText(longView.profit, currency)}
          panel={longView.chips ?? undefined}
          below={<div className="ui-cp-head">{periodSwitch}{longView.head}{longView.chips}</div>}
        />
        {longView.body}
        {basisFooter}
      </div>
    );
  }
  const profit = model.profit;
  const subtitle = `${monthName} ${year} · ${onCurrent ? "עד היום" : "חודש סגור"}`;
  const figure = (
    <p className="ui-cp-figure">
      <Amount agorot={profit} currency={currency} size="display" loss={profit < 0n} direction={profit > 0n ? "income" : undefined} />
    </p>
  );
  const summary = <CompanySummaryCard rows={companySummaryRows(model, monthKey)} currency={currency} />;
  // Next month and the chart belong to the current month: an earlier month's page shows its own figures only.
  const nextBlock = !onCurrent ? null : (
    <CompanyNextMonthBlock
      forecast={next.forecast}
      loading={next.pending}
      months={chartMonths.months}
      current={currentKey}
      thisMonthExpense={model.expense}
      currency={currency}
      categories={next.categories}
      today={today}
    />
  );
  const lineRow = (line: ProfitLine, hint: string) => (
    <ListRow
      key={line.id}
      layout="flat"
      variant="transaction"
      title={line.title}
      hint={hint}
      agorot={line.amount < 0n ? -line.amount : line.amount}
      currency={currency}
      sign={line.direction === "income" ? "in" : "cost"}
      source={rowSource(line.source)}
      initials={lineInitials(line.title)}
      href={`/transactions/${line.transactionId}${search}`}
    />
  );
  let body: ReactNode;
  if (by === "project") {
    body = (
      <List layout="flat" className="ui-cp-list">
        {model.projects.map((row) => {
          const content = (
            <>
              <span className="ui-cp-top">
                <span className="ui-cp-name">{row.name}</span>
                <Amount agorot={row.profit} currency={currency} loss={row.profit < 0n} direction={row.profit > 0n ? "income" : undefined} />
              </span>
              <span className="ui-cp-meta t-caption t-muted">{countWord(row.count)}</span>
            </>
          );
          return (
            <li key={row.key} className="ui-cp-row">
              {row.projectId == null ? <div className="ui-cp-link">{content}</div> : <Link className="ui-cp-link" to={projectProfitPath(row.projectId, search)}>{content}</Link>}
            </li>
          );
        })}
      </List>
    );
  } else if (by === "category") {
    const groups = companyCategoryGroups(model);
    const firstOpen = sample?.openFirst === true ? groups[0]?.categories[0]?.key ?? null : null;
    body = (
      <ProfitCategories
        groups={groups}
        currency={currency}
        initialOpen={firstOpen}
        renderLine={(line) => lineRow(line, `${dayMonth(line.date)} · ${line.project ?? "בלי פרויקט"}`)}
      />
    );
  } else {
    const sorted = [...model.lines].sort(byDateThenSize);
    const groups: Array<{ key: string; title: string; sum: bigint | null; lines: ProfitLine[] }> = by === "amount"
      ? [{ key: "amount", title: "מהגדול לקטן", sum: null, lines: [...model.lines].sort(bySizeOnly) }]
      : [...new Set(sorted.map((line) => line.date))].map((date) => {
          const lines = sorted.filter((line) => line.date === date);
          return { key: date, title: lineDayTitle(date, today), sum: lines.reduce((acc, line) => acc + line.amount, 0n), lines };
        });
    body = (
      <>
        {groups.map((group) => (
          <section key={group.key} className="ui-lines-group" aria-label={group.title}>
            <div className="ui-lines-group-head">
              <h2 className="t-section ui-lines-group-title">{group.title}</h2>
              {group.sum != null ? (
                <bdi className="t-line2 ui-lines-group-sum" dir="ltr" style={group.sum < 0n ? { color: "var(--color-signal)" } : undefined}>{signedText(group.sum, currency)}</bdi>
              ) : (
                <span className="t-caption t-muted">{countWord(group.lines.length)}</span>
              )}
            </div>
            <List layout="flat" className="ui-cp-list">
              {group.lines.map((line) => lineRow(line, by === "amount" ? `${dayMonth(line.date)} · ${line.project ?? "בלי פרויקט"}` : [line.project ?? "בלי פרויקט", line.category].join(" · ")))}
            </List>
          </section>
        ))}
      </>
    );
  }
  return (
    <div className="ui-cp-screen">
      <ScreenHeader
        layout="stacked"
        title="רווח"
        backTo={back}
        backText="בית"
        subtitle={subtitle}
        compactFigure={signedText(profit, currency)}
        panel={chips}
        below={<div className="ui-cp-head">{periodSwitch}{figure}{summary}{nextBlock}{chips}</div>}
      />
      {body}
      {basisFooter}
    </div>
  );
}
