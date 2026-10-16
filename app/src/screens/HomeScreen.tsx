import { useCompanyCurrency } from "../company-currency";
import { wholeShekels, type CashMonths, type CashToDay, type Dashboard, type ProjectRow } from "@flow/shared";
import {
  companyRows,
  dashboardHasBooks,
  heroLabelProfit,
  primaryCurrency,
  profitInCurrency,
  profitSign,
  projectAmountFigures,
  roundedHeroProfit,
} from "../by-currency";
import { onlineManager } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHeldOrder } from "../list-hold";
import { useLocation, useNavigate } from "react-router-dom";
import { unpaidOpenGross, unpaidOpenRows, unpaidTotals } from "../unpaid";
import { useAuth } from "../auth";
import { cashMonthKey, cashRows, profitPath, shownCashRows } from "../cash";
import { useCashMonthData, useCashMonthsQuery, useCashYearsQuery } from "../use-cash";
import { useCashToDayQuery } from "../use-cash-to-day";
import { useSheetHistory } from "../ui/back";
import { pageEnterStyle } from "../ui/motion";
import { israelToday } from "../ui/date-math";
import { monthPeriod, shiftMonthKey } from "../period";
import { homeMonthKey, homeMonthPath, forecastMinor } from "../home-month";
import { HomeBandActions, HomeCompactBar, HomeMonthPill, HomeSwipeFigures, SplitCard, AttentionBox, ForecastRow, monthName, useCompactShown, type HomeFigureRows, type HomeMonthNav } from "./home-parts";
import { MonthDrawer } from "./month-drawer";
import { BackButton } from "../ui/back";
import { BannerRows, type BannerRow } from "../ui/banner";
import { Button } from "../ui/button";
import { ChangePill } from "../ui/change-pill";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { FlowLines, Hero } from "../ui/hero";
import { ChartIcon, TransferIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { PeriodPicker } from "../ui/period-picker";
import { PeriodSwipe } from "../ui/period-swipe";
import { ProfitMark } from "../ui/profit-mark";
import { SearchEntry } from "../ui/search-entry";
import { CashHomeSkeleton, HomeSkeleton } from "./home-skeleton";
import { TextLink } from "../ui/text-link";
import { TopBand } from "../ui/top-band";
import { emptyHomeLabel, emptyProfitLabel } from "../home-label";
import { breakdownPath } from "../breakdown";
import { comparisonWords, heroProfitLabel, periodPhrase, windowLabel, type PeriodChoice } from "../period";
import { previewHidesBand, useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldOwnerSettings } from "../use-is-viewer";
import { CompanySwitcher } from "./company-switcher";
import { useBooks, useDashboardQuery, useOptionalBooks, useUnpaidQuery } from "../use-books";
import { SetupHomeSlot } from "../setup/home";
import { chargeChangeViews, lateCounts, openMonthDue, useCompanyExpectedQuery, useMissingBillsQuery, useRecurringChangesQuery } from "../forecast";
import { attentionRows } from "./attention-rows";

export { attentionRows };

function changePercent(current: bigint, previous: bigint | null): number | null {
  if (previous == null || previous === 0n) return null;
  const currentShekels = wholeShekels(current);
  const previousShekels = wholeShekels(previous);
  if (previousShekels === 0) return null;
  return ((currentShekels - previousShekels) / Math.abs(previousShekels)) * 100;
}

/** Marks the page while a band shows (the status bar follows it), and while a failure hides it. */
function useBandMark(failed: boolean, showBooks: boolean) {
  useEffect(() => {
    if (!failed && showBooks) {
      document.documentElement.dataset.band = "on";
      return () => {
        delete document.documentElement.dataset.band;
      };
    }
    if (!failed) return;
    document.documentElement.dataset.band = "off";
    return () => {
      delete document.documentElement.dataset.band;
    };
  }, [failed, showBooks]);
}

/**
 * Before a bank or SUMIT is connected there are no books: the band names it and the action connects one.
 * Home is the cash view, so it promises the תזרים; the profit view keeps "רווח" (FLOW-362).
 */
function NoBooksYet({ previewing, example, search, companyName, view }: { previewing: boolean; example?: ReactNode; search: string; companyName?: string | null; view: "cash" | "profit" }) {
  // FLOW-601: connecting a bank or SUMIT is the owner's.
  const holdWrites = useHoldOwnerSettings();
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <TopBand
        preview={previewing}
        example={example}
        wordmark={false}
        leading={previewing ? undefined : <CompanySwitcher fallbackName={companyName} />}
        trailing={view === "cash" ? <HomeBandActions isPast={false} currentName="" search={search} /> : undefined}
      >
        <Hero label={view === "cash" ? emptyHomeLabel : emptyProfitLabel} />
      </TopBand>
      <EmptyState
        icon={view === "cash" ? <TransferIcon /> : <ChartIcon />}
        title="עוד אין נתונים"
        body={view === "cash" ? "התזרים יופיע כאן אחרי חיבור בנק או SUMIT." : "הרווח יופיע כאן אחרי חיבור בנק או SUMIT."}
        action={holdWrites ? undefined : (
          // FLOW-328: a bank or SUMIT both start the books, so the action opens the connections page.
          <Button variant="pill" to={`/settings/connections${search}`}>
            חיבור בנק או SUMIT
          </Button>
        )}
      />
      <SetupHomeSlot emptyHome />
    </div>
  );
}

/**
 * Home: the month's cash (FLOW-413, the owner's "Cash first"), redesigned in FLOW-364. The band
 * holds the company, +, search and the avatar, the month pill and its figures; the split card,
 * the attention box and the forecast follow. A past month reads the same way in the darker band.
 * The profit view is one tap away on "רווח החודש". The month comes from `?month=`.
 */
export function HomeScreen({ example }: { example?: ReactNode } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const { status } = useAuth();
  const previewing = preview !== "off";
  const cash = useCashMonthsQuery();
  const years = useCashYearsQuery();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();
  // FLOW-403: late recurring bills, a count on the attention box. A failed read just hides the row.
  const missing = useMissingBillsQuery();
  const late = lateCounts(missing.data ?? []);
  // FLOW-415: recurring charges 20% or more off their usual amount. A failed read hides the rows.
  const changes = useRecurringChangesQuery();

  const today = israelToday();
  const currentKey = today.slice(0, 7);
  const firstKey = years.data?.first_month ? cashMonthKey(years.data.first_month) : null;
  const monthKey = homeMonthKey(location.search, today, firstKey);
  const isCurrent = monthKey === currentKey;
  const older = useCashMonthData(monthKey);
  const base = cash.data?.base_currency ?? "ILS";
  // FLOW-364: the previous month up to the same day (the current month), and the open month's
  // recurring money still due for the forecast row. Both are read only on the current month.
  const sameDay = useCashToDayQuery(shiftMonthKey(monthKey, -1), Number(today.slice(8, 10)), isCurrent);
  const expected = useCompanyExpectedQuery(isCurrent);

  const cashPhase = screenPhase(preview, cash);
  const dashboardPhase = screenPhase(preview, dashboard);
  const errorPhase = cashPhase.kind === "error" ? cashPhase : dashboardPhase.kind === "error" ? dashboardPhase : null;
  const ready = cashPhase.kind === "ready" && dashboardPhase.kind === "ready";
  const showBooks = ready && cash.data != null && dashboard.data != null && hasBooks(dashboard.data);
  const loading = errorPhase == null && (cashPhase.kind === "loading" || dashboardPhase.kind === "loading" || (!previewing && status === "loading" && !showBooks));
  const failed = errorPhase != null || previewHidesBand(preview);
  const offline = errorPhase != null ? errorPhase.offline : preview === "error";
  useBandMark(failed, showBooks);

  function retry() {
    if (previewing) {
      void navigate("/?preview=1");
      return;
    }
    void cash.refetch();
    void dashboard.refetch();
    void unpaid.refetch();
  }

  if (loading) return <CashHomeSkeleton preview={previewing} example={example} />;

  if (failed) {
    return <ErrorState offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks || cash.data == null) {
    return <NoBooksYet previewing={previewing} example={example} search={search} companyName={dashboard.data?.name} view="cash" />;
  }

  // The selected month's figures: Home's recent months, or an older month's year (its own read).
  const data = isCurrent ? cash.data : older.query.data;
  if (data == null) return <CashHomeSkeleton preview={previewing} example={example} />;

  const unpaidPhase = screenPhase(preview, unpaid);
  const unpaidGross = unpaidPhase.kind === "ready" ? unpaidOpenGross(unpaid.data ?? []) : 0n;
  const currentRow = cash.data.months.find((month) => cashMonthKey(month.month) === currentKey);
  const net = cashRows(currentRow, base).find((row) => row.currency === base)?.net_minor ?? 0n;
  const due = openMonthDue(expected.data, base);
  const forecast = isCurrent ? forecastMinor(net, due.income, due.expense, unpaidGross) : null;
  const navigateTo = (key: string) => {
    void navigate(homeMonthPath(key, location.search, currentKey), { replace: true });
  };

  return (
    <CashHome
      data={data}
      monthKey={monthKey}
      currentKey={currentKey}
      firstKey={firstKey}
      previewing={previewing}
      search={search}
      attention={isCurrent ? attentionRows({
        pending: dashboard.data.review_count,
        unpaidCount: unpaidPhase.kind === "ready" ? unpaidOpenRows(unpaid.data ?? []).length : 0,
        unpaidGross,
        unpaidOther: unpaidPhase.kind === "ready" ? unpaidTotals(unpaid.data ?? []).filter((total) => total.currency !== "ILS") : [],
        missingCount: late.expense,
        missingIncome: late.income,
        changes: chargeChangeViews(changes.data ?? [], search),
        search,
      }) : []}
      unpaidFailed={isCurrent && unpaidPhase.kind === "error"}
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      sameDay={isCurrent ? sameDay.data ?? null : null}
      forecast={forecast != null && forecast.show ? forecast.minor : null}
      onStepMonth={navigateTo}
      checklist={isCurrent ? <SetupHomeSlot emptyHome={false} /> : null}
      company={previewing ? undefined : <CompanySwitcher fallbackName={dashboard.data.name} />}
    />
  );
}

/**
 * The band, the figures, the split card and the attention box. `data` holds the selected month
 * (and the month before it, for the comparison). Pure: HomeScreen supplies the reads.
 */
export function CashHome({
  data,
  monthKey,
  currentKey,
  firstKey = null,
  previewing,
  search,
  attention,
  unpaidFailed = false,
  onUnpaidRetry,
  example,
  checklist,
  company,
  sameDay = null,
  forecast = null,
  onStepMonth,
  initialDrawerOpen = false,
}: {
  data: NonNullable<CashMonths>;
  /** The month shown (YYYY-MM). */
  monthKey: string;
  /** This month (YYYY-MM): a month before it is a past month. */
  currentKey: string;
  /** The books' first month with data (YYYY-MM), or null. */
  firstKey?: string | null;
  previewing: boolean;
  search: string;
  attention: BannerRow[];
  unpaidFailed?: boolean;
  onUnpaidRetry?: () => void;
  /** Storybook sample label. The live home never passes it. */
  example?: ReactNode;
  checklist?: ReactNode;
  /** FLOW-601: the company's name, which opens the חברה sheet, on the band's row 1. */
  company?: ReactNode;
  /** FLOW-364: the previous month's figures up to today's day, from cash_month_to_day (the current month only). */
  sameDay?: CashToDay | null;
  /** FLOW-364: the forecast for the month's end, in the base currency, or null to hide the row. */
  forecast?: bigint | null;
  /** Steps Home to another month (the arrows, a swipe, the drawer). */
  onStepMonth: (key: string) => void;
  /** Stories open the drawer at once. */
  initialDrawerOpen?: boolean;
}) {
  const isPast = monthKey < currentKey;
  const base = data.base_currency;
  const month = data.months.find((row) => cashMonthKey(row.month) === monthKey);
  const rows = shownCashRows(month, base);
  const baseRow = rows[0];
  const prevKey = shiftMonthKey(monthKey, -1);
  const prevMonth = data.months.find((row) => cashMonthKey(row.month) === prevKey);
  const hasPrev = prevMonth != null;
  const prevBase = prevMonth == null ? undefined : cashRows(prevMonth, base).find((row) => row.currency === base);
  const compare = isPast
    ? prevBase == null ? null : { in_minor: prevBase.in_minor, out_minor: prevBase.out_minor }
    : sameDay == null ? null : {
        in_minor: sameDay.find((row) => row.currency === base)?.in_minor ?? 0n,
        out_minor: sameDay.find((row) => row.currency === base)?.out_minor ?? 0n,
      };
  const figures: HomeFigureRows = {
    currency: base,
    rows,
    compare,
    previousName: hasPrev ? monthName(prevKey) : null,
    day: isPast ? null : Number(israelToday().slice(8, 10)),
    isPast,
  };
  const earlierKey = firstKey != null && prevKey >= firstKey ? prevKey : null;
  const laterKey = isPast ? shiftMonthKey(monthKey, 1) : null;
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen);
  const setDrawer = useSheetHistory("month", drawerOpen, setDrawerOpen);
  // A pick closes the drawer by its history pop. The month moves after that pop: a navigation sent
  // before it would be undone by the pop (FLOW-364).
  const pendingMonth = useRef<string | null>(null);
  useEffect(() => {
    if (drawerOpen || pendingMonth.current == null) return;
    const key = pendingMonth.current;
    pendingMonth.current = null;
    onStepMonth(key);
  }, [drawerOpen, onStepMonth]);
  const nav: HomeMonthNav = {
    earlierKey,
    laterKey,
    onStep: onStepMonth,
    onOpenDrawer: () => {
      setDrawer(true);
    },
  };
  const compactShown = useCompactShown();
  const animate = useMonthDirection(monthKey);
  const books = useOptionalBooks();
  const navigate = useNavigate();
  const openProfit = () => {
    books?.setPeriod(monthPeriod(monthKey));
    void navigate(profitPath(search));
  };

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <div className="m-page-enter" style={pageEnterStyle(0)}>
        <TopBand
          wordmark={false}
          preview={previewing}
          example={example}
          tone={isPast ? "past" : "current"}
          leading={company}
          trailing={<HomeBandActions isPast={isPast} currentName={monthName(currentKey)} search={search} />}
        >
          <div className="ui-band-body">
            <HomeMonthPill monthKey={monthKey} nav={nav} />
            <HomeSwipeFigures monthKey={monthKey} figures={figures} search={search} nav={nav} animate={animate} />
            {isPast || forecast == null ? null : <ForecastRow monthKey={monthKey} minor={forecast} currency={base} />}
          </div>
        </TopBand>
      </div>

      {baseRow == null ? null : (
        <div className="m-page-enter" style={pageEnterStyle(1)}>
          <SplitCard monthKey={monthKey} row={baseRow} search={search} onOpenProfit={openProfit} />
        </div>
      )}

      {unpaidFailed ? (
        <div className="ui-page-pad">
          <ErrorState
            offline={false}
            onRetry={() => {
              onUnpaidRetry?.();
            }}
          />
        </div>
      ) : null}
      {/* Design lead: Home shows money that needs a hand whatever its main figure; an empty box hides. */}
      <div className="m-page-enter" style={pageEnterStyle(2)}>
        {isPast ? null : <AttentionBox rows={attention} />}
        {checklist}
      </div>

      <HomeCompactBar monthKey={monthKey} net={baseRow?.net_minor ?? 0n} currency={base} isPast={isPast} nav={nav} shown={compactShown} />
      <MonthDrawer
        open={drawerOpen}
        onOpenChange={setDrawer}
        selectedKey={monthKey}
        firstKey={firstKey}
        base={base}
        search={search}
        onPick={(key) => {
          pendingMonth.current = key;
          setDrawer(false);
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

/** The direction the band's figures came from, for the enter motion (earlier comes from the right in RTL). */
function useMonthDirection(monthKey: string): "earlier" | "later" | null {
  const [seen, setSeen] = useState(monthKey);
  const [direction, setDirection] = useState<"earlier" | "later" | null>(null);
  if (seen !== monthKey) {
    setSeen(monthKey);
    setDirection(monthKey < seen ? "earlier" : "later");
  }
  return direction;
}

/**
 * The profit view (frame b-2), one tap from Home's "רווח החודש": the profit for a period, with
 * הכנסות and הוצאות, the projects and the attention box, as Home showed it before FLOW-413.
 */
export function ProfitScreen({ example }: { example?: ReactNode } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status } = useAuth();
  const previewing = preview !== "off";
  const books = useBooks();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();
  // FLOW-403: late recurring bills, a count on the pending card. A failed read just hides the row.
  const missing = useMissingBillsQuery();
  const companyCurrency = useCompanyCurrency();

  const phase = screenPhase(preview, dashboard);
  const showBooks = phase.kind === "ready" && dashboard.data != null && hasBooks(dashboard.data);
  const loading = phase.kind === "loading" || (!previewing && status === "loading" && !showBooks);
  const failed = phase.kind === "error" || previewHidesBand(preview);
  const offline = phase.kind === "error" ? phase.offline : preview === "error";

  useBandMark(failed, showBooks);

  function retry() {
    if (previewing) {
      void navigate("/profit?preview=1");
      return;
    }
    void dashboard.refetch();
    void unpaid.refetch();
  }

  if (loading) return <HomeSkeleton preview={previewing} example={example} period={books.period} onPeriod={books.setPeriod} />;

  if (failed) {
    return <ErrorState offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks) return <NoBooksYet previewing={previewing} example={example} search={search} companyName={dashboard.data?.name} view="profit" />;

  const unpaidPhase = screenPhase(preview, unpaid);
  return (
    <HomeBooks
      companyCurrency={companyCurrency}
      data={dashboard.data}
      previewing={previewing}
      search={search}
      unpaidGross={unpaidPhase.kind === "ready" ? unpaidOpenGross(unpaid.data ?? []) : 0n}
      unpaidCount={unpaidPhase.kind === "ready" ? unpaidOpenRows(unpaid.data ?? []).length : 0}
      unpaidOther={unpaidPhase.kind === "ready" ? unpaidTotals(unpaid.data ?? []).filter((total) => total.currency !== "ILS") : []}
      unpaidPhase={unpaidPhase.kind}
      missingCount={lateCounts(missing.data ?? []).expense}
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      period={books.period}
      onPeriod={books.setPeriod}
      refreshing={dashboard.isPlaceholderData}
      back={<BackButton fallback={`/${search}`} onBand text="תזרים" label="חזרה לתזרים" />}
    />
  );
}

function hasBooks(data: Dashboard): boolean {
  return dashboardHasBooks(data);
}

export function HomeBooks({
  data,
  previewing,
  search,
  unpaidGross,
  unpaidCount,
  unpaidOther = [],
  unpaidPhase = "ready",
  missingCount = 0,
  missingTo,
  onUnpaidRetry,
  period,
  onPeriod,
  example,
  refreshing = false,
  notice,
  checklist,
  back,
  companyCurrency = "ILS",
  company,
}: {
  /** FLOW-601: the company's name, which opens the חברה sheet. */
  company?: ReactNode;
  /** The company's currency, for an empty period's zeros (a USD company reads $0, not ₪0). */
  companyCurrency?: string;
  data: Dashboard;
  previewing: boolean;
  search: string;
  unpaidGross: bigint;
  unpaidCount: number;
  /** FLOW-330. Open unpaid totals in other currencies, after the ILS one. */
  unpaidOther?: { currency: string; minor: bigint }[];
  unpaidPhase?: "loading" | "error" | "empty" | "ready";
  /** FLOW-403. Recurring bills that are late this month; the row shows only above 0. */
  missingCount?: number;
  /** Dev fixtures send the late-bills row here. Production opens `/missing-bills`. */
  missingTo?: string;
  onUnpaidRetry?: () => void;
  period: PeriodChoice;
  onPeriod: (choice: PeriodChoice) => void;
  /** Storybook sample label. The live home never passes it. */
  example?: ReactNode;
  /** ld-07. The spinner sits above the band content. */
  refreshing?: boolean;
  /** ld-09. A note under the band, above the pending card. */
  notice?: ReactNode;
  checklist?: ReactNode;
  /** FLOW-413 (frame b-2): the profit view's way back to Home's cash, on the band's start. */
  back?: ReactNode;
}) {
  const rankCurrency = primaryCurrency(data);
  const ranked = homeProjects(data.projects, rankCurrency);
  const leading = useHeldOrder(ranked, (project) => project.id);
  const splitList = leading.length > HOME_PROJECTS_BEFORE_ATTENTION;
  const allProjects = (
    <p className="ui-page-pad">
      <TextLink to={`/projects${search}`} tone="quiet">
        לכל הפרויקטים
      </TextLink>
    </p>
  );
  const currencyRows = companyRows(data, data.base_currency ?? companyCurrency);
  const heroFigures = currencyRows.map((row) => ({
    agorot: roundedHeroProfit(row.income_minor, row.expense_minor),
    currency: row.currency,
    loss: roundedHeroProfit(row.income_minor, row.expense_minor) < 0n,
  }));
  const hero = heroLabelProfit(heroFigures);
  // One currency on Home: its change against the previous period (0147). Older payloads have it in ILS only.
  const single = currencyRows.length === 1 ? currencyRows[0] : undefined;
  const previous = single == null
    ? null
    : single.prev_income_minor != null && single.prev_expense_minor != null
      ? roundedHeroProfit(single.prev_income_minor, single.prev_expense_minor)
      : single.prev_net_profit_minor !== undefined
        ? single.prev_net_profit_minor
        : single.currency !== "ILS"
          ? null
          : data.prev_income_agorot != null && data.prev_expense_agorot != null
            ? roundedHeroProfit(data.prev_income_agorot, data.prev_expense_agorot)
            : data.prev_net_agorot;
  const percent = single ? changePercent(heroFigures[0]?.agorot ?? 0n, previous) : null;
  const [periodSheet, setPeriodSheet] = useState(false);
  const comparison = comparisonWords(period);
  const phrase = periodPhrase(period);
  const attention = attentionRows({
    pending: data.review_count,
    unpaidCount: unpaidPhase === "ready" ? unpaidCount : 0,
    unpaidGross,
    unpaidOther,
    missingCount,
    missingTo,
    search,
  });

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <TopBand
        wordmark={false}
        preview={previewing}
        example={example}
        status={refreshing ? (
          <div className="ui-ptr">
            <span className="ui-spinner" role="status" aria-label="מרענן" />
          </div>
        ) : null}
        leading={back ?? company}
        trailing={<SearchEntry to={`/search${search}`} onBand />}
      >
        {/* FLOW-336: a sideways swipe on the figure steps the period (decision 0150). */}
        <PeriodSwipe period={period} onChange={onPeriod}>
          <Hero
            label={heroProfitLabel(period, profitSign(heroFigures.map((figure) => figure.agorot)) === "mixed" ? "mixed" : hero)}
            figures={heroFigures}
            pill={
              // FLOW-355 (A): one period pill instead of the tabs and stepper, so a project row fits on a 667px screen.
              <PeriodPicker pill={windowLabel(period)} name={`${windowLabel(period)} – בחירת תקופה`} open={periodSheet} onOpenChange={setPeriodSheet} period={period} onChange={onPeriod} />
            }
          />
        </PeriodSwipe>
      </TopBand>

      {notice}

      <FlowLines
        lines={currencyRows.map((row) => ({
          currency: row.currency,
          income: row.income_minor,
          expense: row.expense_minor,
        }))}
        links={{
          income: breakdownPath("income", search),
          expense: breakdownPath("expense", search),
          period: phrase,
        }}
      />
      {comparison && percent != null ? (
        <p className="ui-flow-note">
          <ChangePill percent={percent} comparison={comparison} />
        </p>
      ) : null}

      {checklist}

      <SectionHead title="פרויקטים" />
      {leading.length === 0 ? (
        <p className="ui-page-pad t-hint">אין תנועות בפרויקטים בתקופה הזו.</p>
      ) : (
        <ProjectLines projects={leading.slice(0, HOME_PROJECTS_BEFORE_ATTENTION)} search={search} rankCurrency={rankCurrency} />
      )}
      {/* FLOW-358: with two projects or fewer the link stays under the last project row, before the attention rows. */}
      {splitList ? null : allProjects}

      {/* FLOW-355 (A): the review and invoices rows sit under the first projects, so a project shows on the first screen. */}
      {unpaidPhase === "error" ? (
        <div className="ui-page-pad">
          <ErrorState
            offline={false}
            onRetry={() => {
              onUnpaidRetry?.();
            }}
          />
        </div>
      ) : null}

      <BannerRows rows={attention} />

      {splitList ? (
        <>
          <ProjectLines projects={leading.slice(HOME_PROJECTS_BEFORE_ATTENTION)} search={search} rankCurrency={rankCurrency} />
          {allProjects}
        </>
      ) : null}
    </div>
  );
}

/** FLOW-355: the review and invoices rows come after this many projects. */
const HOME_PROJECTS_BEFORE_ATTENTION = 2;

function ProjectLines({ projects, search, rankCurrency }: { projects: readonly ProjectRow[]; search: string; rankCurrency: string }) {
  return (
    <ul className="ui-project-list">
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectLine project={project} search={search} rankCurrency={rankCurrency} />
        </li>
      ))}
    </ul>
  );
}

/** Home lists at most this many projects (profit by period, plan §2). */
export const HOME_PROJECTS = 5;

function hasLines(project: ProjectRow): boolean {
  if (project.income_agorot !== 0n || project.direct_agorot !== 0n || project.shared_agorot !== 0n) return true;
  return project.by_currency.some((row) => row.income_minor !== 0n || row.direct_minor !== 0n || row.shared_minor !== 0n);
}

/**
 * The projects Home shows for its period: only those with lines in it, losses first (the
 * biggest loss on top), then the most profitable, up to HOME_PROJECTS.
 */
export function homeProjects(projects: readonly ProjectRow[], currency: string): ProjectRow[] {
  return projects
    .filter(hasLines)
    .map((project) => ({ project, profit: profitInCurrency(project, currency) }))
    .sort((a, b) => {
      const lossA = a.profit < 0n;
      const lossB = b.profit < 0n;
      if (lossA !== lossB) return lossA ? -1 : 1;
      if (lossA) return a.profit < b.profit ? -1 : a.profit > b.profit ? 1 : 0;
      return a.profit < b.profit ? 1 : a.profit > b.profit ? -1 : 0;
    })
    .slice(0, HOME_PROJECTS)
    .map((entry) => entry.project);
}


function ProjectLine({ project, search, rankCurrency }: { project: ProjectRow; search: string; rankCurrency: string }) {
  const amounts = projectAmountFigures(project);
  const single = amounts.length === 1 ? amounts[0] : undefined;
  // The mark follows the main currency; other currencies show their own figure under it (0096).
  const marked = amounts.find((amount) => amount.currency === rankCurrency) ?? amounts[0];
  const loss = (marked?.minor ?? project.profit_agorot) < 0n;
  return (
    <ListRow
      variant="project"
      title={project.name}
      hint={<ProfitMark loss={loss} />}
      agorot={single?.minor ?? project.profit_agorot}
      currency={single?.currency}
      amounts={amounts.length > 1 ? amounts : undefined}
      loss={(single?.minor ?? project.profit_agorot) < 0n}
      href={`/projects/${project.id}${search}`}
    />
  );
}
