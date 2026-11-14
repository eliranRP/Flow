import "../ui/lazy.css";
import { formatAmountText, type SearchRow } from "@flow/shared";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { lineDayTitle, lineInitials } from "../cash-lines-groups";
import { useCompanyCurrency } from "../company-currency";
import { homeMonthKey, homeMonthPath } from "../home-month";
import { useOverheadProject, type OverheadProject } from "../overhead-project";
import { customRange, monthPeriod } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { HEBREW_MONTHS, israelToday } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { OrderChips } from "../ui/order-chips";
import { List, ListRow } from "../ui/list-row";
import type { ScreenPhase } from "../ui/screen-phase";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitRowsSkeleton, ProfitSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { ScreenState } from "../ui/screen-state";
import { rowSource } from "../ui/line-marks";
import { BASIS_PROFIT_COPY, basisChoiceLabel } from "../ui/company-choices";
import { buildProfitModel, linesIdOfRow, useCompanyProfitRead, type ProfitInputs, type ProfitLine, type ProfitModel } from "../use-company-profit";
import { EMPTY_FILTERS, SEARCH_DEBOUNCE_MS, searchRowDetails, searchRowTitle, uniqueSearchRows, useDebounced, useSearchQuery } from "../search";
import { SearchField } from "../ui/search-field";
import { SearchEmptyState } from "../ui/empty-state";
import { Button } from "../ui/button";
import { byDateThenSize, bySizeOnly, companyCategoryGroups, companyKeptOutCategories, companySummaryRows } from "../company-profit-rows";
import { useAfterFirstPaint } from "../after-paint";
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
 * project (null for none).
 */
export type CompanyProfitSample = ProfitInputs & { today: string; monthKey: string; overhead: OverheadProject | null; openFirst?: boolean; sheetOpen?: boolean; next?: CompanyNextMonthSample; years?: CompanyYearsSample; offlineSince?: number };

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
  // FLOW-1194: the category lines the page asked for (a row scrolled near, or tapped), each read once.
  const [wanted, setWanted] = useState<ReadonlySet<string>>(() => new Set());
  const want = useCallback((rowKey: string) => {
    const id = linesIdOfRow(rowKey);
    setWanted((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const [typed, setTyped] = useState("");
  const companyCurrency = useCompanyCurrency();
  const online = useOnline();
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
  // A failed read is the page's failure, with its retry: falling back to כללי would split the row again.
  const overheadRead = useOverheadProject(sample == null);
  const overhead = sample == null ? overheadRead.project : sample.overhead;
  // Only a לפי פרויקט list waits for (or fails on) that read; the other lists and orders never show the row.
  const monthByProject = period === "month" && by === "project";
  const yearByProject = period === "year" && yearList === "project";
  const live = useCompanyProfitRead({
    enabled: sample == null,
    month,
    ytd: customRange(`${year}-01-01`, month.to ?? today),
    currency: companyCurrency,
    // The year and since-the-start views ignore the order: only the month view draws the categories.
    categoriesOn: period === "month" && by !== "project",
    // FLOW-1191: the year and since-the-start views read the years' months only.
    projectsOn: period === "month",
    overhead: monthByProject ? overhead : overhead ?? null,
    // The date and amount lists need every line, in one paged read; the category order reads a category when it is near.
    linesAll: by === "date" || by === "amount",
    lineIds: wanted,
  });
  // FLOW-1194: the search asks the server (search_transactions) for the month's lines, so a line in a category that
  // has not loaded is found too.
  const settled = useDebounced(typed, SEARCH_DEBOUNCE_MS).trim();
  const found = useSearchQuery({ ...EMPTY_FILTERS, q: settled, period: month }, sample == null && period === "month" && settled !== "");
  const model: ProfitModel | null = sample ? buildProfitModel(sample, sample.overhead) : live.model;
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
  // FLOW-1080 (as Home, FLOW-1019): the next-month reads start once the figures are drawn, so they do not share
  // the link with the figures' own reads; a return with the figures cached reads them at once.
  const afterPaint = useAfterFirstPaint(long ? yearsData != null : model != null);
  const next = useCompanyNextMonth(sample?.currency ?? companyCurrency, today, wantsForecast && afterPaint, sample?.next, undefined, long);
  // Data already cached (from Home, or an earlier visit) shows at once; only a read not yet started waits.
  const nextWaiting = next.pending || (wantsForecast && !afterPaint && next.input == null);
  const chartMonths = useCompanyProfitMonths(today, onCurrent && !long, sample?.next);
  const yearProjects = useCompanyYearProjects(viewYear, today, yearByProject, sample?.years);
  const failed = live.failed || (monthByProject && overheadRead.failed) || (long && years.failed);
  // The year views draw from the years' read, with the figures' skeleton inside them (below).
  const waiting = !long && model == null;
  const basis = model?.basis ?? years.basis;
  const phase: ScreenPhase = sample != null ? { kind: "ready" } : preview !== "off" ? screenPhase(preview) : failed ? { kind: "error", offline: !online } : waiting ? { kind: "loading" } : { kind: "ready" };
  const [sheetState, setSheetOpen] = useState<boolean | undefined>(undefined);
  const basisRef = useRef<HTMLButtonElement>(null);
  const back = homeMonthPath(monthKey, search, currentKey);
  if (phase.kind !== "ready") {
    // The board's loading frame names the month in the title: the stacked header's own bar, Back labelled בית.
    const loadingTitle = period === "month" ? `רווח ${HEBREW_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey}` : "רווח";
    return (
      <ScreenState
        stacked
        headerClassName="ui-state-header"
        title={phase.kind === "loading" ? loadingTitle : "רווח"}
        kicker="בית"
        backTo={back}
        phase={phase}
        onRetry={() => { live.refetch(); overheadRead.refetch(); years.refetch(); }}
        loading={<ProfitSkeleton />}
        // FLOW-969: a failed read hides the figures and says what happened, with נסו שוב and צריך עזרה?.
        failed={(retry, offline) => <PageLoadFailed title={`${loadingTitle} לא נטען`} offline={offline} onRetry={retry} />}
      />
    );
  }
  const currency = model?.currency ?? companyCurrency;
  // FLOW-969: offline, the page keeps its last read and says which moment it is from.
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? ((long ? years.readAt : live.readAt) || null) : null;
  const offlineLine = offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />;
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
    restLoading: nextWaiting,
    restFailed: next.failed,
    categories: next.categories,
    list: yearList,
    projects: {
      breakdowns: yearProjects.breakdowns,
      statuses: yearProjects.statuses,
      overhead: overhead ?? null,
      pending: yearProjects.pending || (overhead === undefined && !overheadRead.failed),
      failed: yearProjects.failed || overheadRead.failed,
      onRetry: () => { yearProjects.refetch(); overheadRead.refetch(); },
    },
    onList: (list) => { setParams({ list: list === "month" ? null : list }); },
    // This month's row opens the month view on this month; a year's row opens that year.
    onOpen: (opens) => { setParams(opens.kind === "month" ? { period: null, year: null, list: null, month: null } : { period: "year", year: opens.year === currentYear ? null : opens.year, list: null }); },
    projectHref: (projectId) => projectProfitPath(projectId, search),
  });
  const chips = <OrderChips className="ui-cp-chips" label="סידור" value={by} options={ORDERS} onChange={setBy} />;
  const basisFooter = basis == null ? null : (
    <>
      <p className="ui-cp-foot t-caption t-muted">לא נספר ברווח: נכסים והתחייבויות, כמו קנייה של נכס, הלוואה, קרן ופיקדון מסים וביטוח. הם נשארים בספר ובתזרים, לא ברווח.</p>
      <button type="button" ref={basisRef} className="ui-cp-basis" onClick={() => { setSheetOpen(true); }}>
        נספר לפי {basisChoiceLabel(basis)} · <span className="ui-cp-change">שינוי</span>
      </button>
      <CompanyBasisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        basis={basis}
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
          below={<div className="ui-cp-head">{periodSwitch}{longView.head}{offlineLine}{longView.chips}</div>}
        />
        {longView.body}
        {basisFooter}
      </div>
    );
  }
  // The year views returned above.
  if (model == null) return null;
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
      loading={nextWaiting}
      months={chartMonths.months}
      monthsLoading={chartMonths.loading}
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
      hint={line.grossUp ? <>{hint}{" · "}<span className="ui-cp-grossup">שולם מהפקדה</span></> : hint}
      agorot={line.amount < 0n ? -line.amount : line.amount}
      currency={currency}
      // A kept-out line is money moved, not income or a cost (FLOW-954): "+" in the text colour, or "−" on money out.
      sign={line.keptOut === true ? (line.direction === "income" ? "moved-in" : "out") : line.direction === "income" ? "in" : "cost"}
      setAside={line.keptOut === true}
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
        keptOut={companyKeptOutCategories(model)}
        currency={currency}
        initialOpen={firstOpen}
        onWant={sample == null ? want : undefined}
        linesState={sample == null ? live.linesState : undefined}
        onRetry={sample == null ? live.retryLines : undefined}
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
  // FLOW-1194: a typed word swaps the list for the lines the server found in this month, whatever the order.
  const hits = uniqueSearchRows(found.data?.pages ?? []);
  const searching = period === "month" && settled !== "";
  // The rows are the search screen's own (statement rows), so a found line reads as it does there.
  const foundRow = (row: SearchRow) => (
    <ListRow
      key={row.id}
      variant="statement"
      title={searchRowTitle(row)}
      fallback="invoice"
      details={searchRowDetails(row)}
      setAside={row.kept_out}
      agorot={row.amount_net}
      currency={row.currency}
      sign={row.direction === "income" ? "in" : "out"}
      href={`/transactions/${row.id}${search}`}
    />
  );
  const searchBox = (
    <div className="ui-cp-search ui-rep-search">
      <SearchField label="חיפוש בתנועות" value={typed} onChange={setTyped} placeholder="ספק, תיאור או סכום" busy={searching && found.isFetching} />
    </div>
  );
  const foundBody = (
    <>
      {/* The live region is on the page before the answer, so a screen reader announces the empty result. */}
      <div role="status" className="ui-cp-found-status">{found.data != null && hits.length === 0 ? <SearchEmptyState text={settled} withChips={false} onClear={() => { setTyped(""); }} /> : null}</div>
      <List layout="flat" className="ui-cp-list">{hits.map(foundRow)}</List>
      {found.hasNextPage ? <Button variant="link" busy={found.isFetchingNextPage} onClick={() => { void found.fetchNextPage(); }}>עוד תנועות</Button> : null}
    </>
  );
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
        below={<div className="ui-cp-head">{periodSwitch}{figure}{offlineLine}{summary}{nextBlock}{chips}</div>}
      />
      {period === "month" ? searchBox : null}
      {searching ? foundBody : body}
      {basisFooter}
    </div>
  );
}
