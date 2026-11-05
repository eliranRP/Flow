import { type CashMonths, type CashToDay } from "@flow/shared";
import { SyncStrip } from "../ui/sync-strip";
import { cashHasBooks, dashboardHasBooks } from "../by-currency";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { unpaidOpenGross, unpaidOpenRows, unpaidTotals } from "../unpaid";
import { useAuth } from "../auth";
import { cashMonthKey, cashRows, shownCashRows } from "../cash";
import { useCashLinesQuery, useCashMonthData, useCashMonthsQuery, useCashYearsQuery } from "../use-cash";
import { useCashToDayQuery } from "../use-cash-to-day";
import { Amount } from "../ui/amount";
import { useSheetHistory } from "../ui/back";
import { pageEnterStyle } from "../ui/motion";
import { israelToday } from "../ui/date-math";
import { shiftMonthKey } from "../period";
import { homeMonthKey, homeMonthPath } from "../home-month";
import { useAfterFirstPaint } from "../after-paint";
import { useMonthForecastQuery } from "../month-forecast-query";
import { HomeBandActions, HomeCompactBar, HomeMonthPill, HomeSwipeFigures, ForecastRow, homeMonthLabel, monthName, type HomeFigureRows, type HomeMonthNav } from "./home-parts";
import { ActivityFilterControl, HomeActivity, type ActivityFilter, type HomeActivityData } from "./home-activity";
import { useRecurringScheduleQuery } from "../recurring-schedule";
import { AttentionCards } from "../ui/attention-cards";
import { useDockedFilter } from "../ui/dock-filter";
import { MonthDrawer } from "./month-drawer";
import { BandLoadFailed, BandOfflineLine, useOnline } from "../ui/band-states";
import type { BannerRow } from "../ui/banner";
import { Button } from "../ui/button";
import { FailureLine } from "../ui/empty-state";
import { BankIcon } from "../ui/icons";
import { CashHomeSkeleton } from "./home-skeleton";
import { TopBand, useBandGone } from "../ui/top-band";
import { previewFails, useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldOwnerSettings } from "../use-is-viewer";
import { CompanySwitcher } from "./company-switcher";
import { useDashboardQuery, useUnpaidQuery } from "../use-books";
import { SetupHomeSlot } from "../setup/home";
import { chargeChangeViews, lateCounts, useMissingBillsQuery, useRecurringChangesQuery } from "../forecast";
import { attentionRows } from "./attention-rows";
import { useTransferMatchCountQuery } from "../transfer-match-count";
import { reviewWaiting, useJevBookingCountQuery } from "../jev-booking-count";
import { cardWeek, weeklyCardHidden } from "../weekly-card";
import { useReturningRecurringOwner } from "../recurring-tip";

// FLOW-517: the weekly summary sheet loads only when the push's `?week=` link opens Home.
const WeeklySummaryRoute = /* @__PURE__ */ lazy(() => import("./weekly-summary-sheet").then((m) => ({ default: m.WeeklySummaryRoute })));
// FLOW-956: last week's card, Sunday to Tuesday; it and its read load in their own chunk too.
const WeeklySummaryCardSlot = /* @__PURE__ */ lazy(() => import("./weekly-summary-card").then((m) => ({ default: m.WeeklySummaryCardSlot })));
// FLOW-1036: next month's forecast in the month drawer, with its reads, loads in its own chunk too.
const DrawerNextMonth = /* @__PURE__ */ lazy(() => import("./month-drawer-next").then((m) => ({ default: m.DrawerNextMonth })));

export { attentionRows };

/** Marks the page while a band shows (the status bar follows it). FLOW-958: a failure keeps the band. */
function useBandMark(shown: boolean) {
  useEffect(() => {
    if (!shown) return;
    document.documentElement.dataset.band = "on";
    return () => {
      delete document.documentElement.dataset.band;
    };
  }, [shown]);
}

/**
 * FLOW-364 (board, StatesHomeEmpty): the cash first run with no books. `leading` is the company
 * (or nothing in preview); `currency` is the company's base currency; `avatarInitial` is the band's
 * initial when the company has one (the board's "N").
 */
export function CashEmptyHome({
  leading,
  search,
  example,
  holdWrites,
  currency = "ILS",
  avatarInitial,
}: {
  leading?: ReactNode;
  search: string;
  example?: ReactNode;
  holdWrites: boolean;
  currency?: string;
  avatarInitial?: string;
}) {
  // FLOW-364 (board, StatesHomeEmpty): the band with the month and a zero figure, then the bank card and what will show here.
  const currentKey = israelToday().slice(0, 7);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <TopBand
        preview={false}
        example={example}
        wordmark={false}
        leading={leading}
        trailing={<HomeBandActions isPast={false} currentName="" search={search} avatarInitial={avatarInitial} />}
      >
        <div className="ui-band-body ui-band-body-empty">
          <p className="ui-band-month-static">{homeMonthLabel(currentKey)}</p>
          <div className="ui-band-hero">
            <div className="ui-hero">
              <p className="ui-band-label t-line2">{`תזרים ${monthName(currentKey)}`}</p>
              <h1 className="ui-hero-figure ui-band-fade"><span><Amount agorot={0n} currency={currency} size="hero" /></span></h1>
              <p className="ui-hero-explain t-line2">עוד אין תנועות. הן יגיעו מהבנק.</p>
            </div>
          </div>
        </div>
      </TopBand>
      <section className="ui-home-empty-card" dir="rtl" aria-labelledby="home-empty-title">
        <span className="ui-home-empty-icon" aria-hidden="true"><BankIcon size={24} /></span>
        <h2 id="home-empty-title" className="ui-home-empty-title">חברו את הבנק</h2>
        <p className="ui-home-empty-body">Flow מביא את התנועות מ־Mercury, ממיין אותן לפי פרויקט ומחשב את הרווח. לוקח דקה.</p>
        {/* FLOW-328 / FLOW-601: a bank starts the books, so the action opens the connections page; the owner's only. */}
        {holdWrites ? null : (
          <>
            <Button full to={`/settings/connections${search}`}>חיבור Mercury</Button>
            <p className="ui-home-empty-link-row"><Link to={`/add${search}`} className="ui-home-empty-manual">בינתיים, הוספה ידנית</Link></p>
          </>
        )}
      </section>
      <section className="ui-home-empty-what" dir="rtl" aria-labelledby="home-empty-what-title">
        <h2 id="home-empty-what-title" className="ui-home-empty-what-title">מה יופיע כאן</h2>
        <ul className="ui-home-empty-list">
          <li>כמה נכנס וכמה יצא החודש, מול החודש הקודם</li>
          <li>שורות שמחכות לאישור שלכם</li>
          <li>תזרים צפוי לסוף החודש לפי הקבועים והחשבוניות</li>
        </ul>
      </section>
      <SetupHomeSlot emptyHome />
    </div>
  );
}

/**
 * Home: the month's cash (FLOW-413, the owner's "Cash first"), redesigned in FLOW-364. The band
 * holds the company, +, search and the avatar, the month pill, its figures and the forecast row.
 * FLOW-1036 (v3, pattern Overview): under it the דורש טיפול cards, then the month's activity with
 * its filter, which docks into the compact bar. A past month reads the same way in the darker band.
 * The month comes from `?month=`.
 */
export function HomeScreen({ example }: { example?: ReactNode } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const { status } = useAuth();
  // FLOW-601: connecting a bank or SUMIT is the owner's.
  const holdWrites = useHoldOwnerSettings();
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
  // FLOW-941: suggested transfers between two Mercury connections, a count. A failed read hides the row.
  const transfers = useTransferMatchCountQuery();
  // FLOW-955 (owner): Jev's bookings waiting for review count in לאישור too.
  const jevBookings = useJevBookingCountQuery();
  // FLOW-1015: the קבועים tip is for an owner who had the tab: one with recurring rows.
  const recurringOwner = useReturningRecurringOwner(!previewing);

  const today = israelToday();
  const currentKey = today.slice(0, 7);
  const firstKey = years.data?.first_month ? cashMonthKey(years.data.first_month) : null;
  const monthKey = homeMonthKey(location.search, today, firstKey);
  const isCurrent = monthKey === currentKey;
  const older = useCashMonthData(monthKey);
  const base = cash.data?.base_currency ?? "ILS";
  // FLOW-364: the previous month up to the same day (the current month), and the month-end forecast for the
  // forecast row (FLOW-1008: the תזרים צפוי screen's own read, so both show one number). Both on the current month only.
  const sameDay = useCashToDayQuery(shiftMonthKey(monthKey, -1), Number(today.slice(8, 10)), isCurrent);

  const cashPhase = screenPhase(preview, cash);
  const dashboardPhase = screenPhase(preview, dashboard);
  // Home waits on cash_months alone when it holds a line. Only a company with no recent line
  // waits for get_dashboard too, so the empty state never shows before Flow knows.
  const cashBooks = cashPhase.kind === "ready" && cash.data != null && cashHasBooks(cash.data);
  const dashboardGate = cashBooks ? null : dashboardPhase;
  const errorPhase = cashPhase.kind === "error" ? cashPhase : dashboardGate?.kind === "error" ? dashboardGate : null;
  const ready = cashPhase.kind === "ready" && (cashBooks || dashboardPhase.kind === "ready");
  const showBooks = ready && cash.data != null && (cashBooks || (dashboard.data != null && dashboardHasBooks(dashboard.data)));
  const loading = errorPhase == null && (cashPhase.kind === "loading" || dashboardGate?.kind === "loading" || (!previewing && status === "loading" && !showBooks));
  const failed = errorPhase != null || previewFails(preview);
  const offline = errorPhase != null ? errorPhase.offline : preview === "error";
  useBandMark(failed || showBooks);
  const online = useOnline();
  // FLOW-1019 (owner, 2026-11-03): the forecast row and החודש הבא read once Home has drawn its figures.
  const afterPaint = useAfterFirstPaint(showBooks);
  const monthForecast = useMonthForecastQuery(currentKey, isCurrent && afterPaint);
  // FLOW-1036: the month's activity: the recurring schedule, and the current month's lines for the one-off group
  // (after first paint, like the forecast). Both on the current month only.
  const schedule = useRecurringScheduleQuery(isCurrent && !previewing);
  const linesIn = useCashLinesQuery(currentKey, "in", base, isCurrent && afterPaint);
  const linesOut = useCashLinesQuery(currentKey, "out", base, isCurrent && afterPaint);

  function retry() {
    if (previewing) {
      void navigate("/?preview=1");
      return;
    }
    void cash.refetch();
    void dashboard.refetch();
    void unpaid.refetch();
  }

  // FLOW-517: the push's link (`?week=<Sunday>`) opens the week's summary over Home. The sheet's own
  // chunk checks the week and drops the parameter on close, so Home's first load carries only this.
  const withWeekly = (page: ReactNode) => previewing || !new URLSearchParams(location.search).has("week") ? page : (
    <>
      {page}
      <Suspense fallback={null}>
        <WeeklySummaryRoute />
      </Suspense>
    </>
  );

  if (loading) return withWeekly(<CashHomeSkeleton preview={previewing} example={example} />);

  if (failed) {
    return (
      <BandLoadFailed
        title={`${monthName(monthKey)} לא נטען`}
        offline={offline || !online}
        onRetry={retry}
        leading={previewing ? undefined : <CompanySwitcher fallbackName={dashboard.data?.name} />}
      />
    );
  }

  if (!showBooks || cash.data == null) {
    // FLOW-601: connecting a bank or SUMIT is the owner's.
    return withWeekly(
      <CashEmptyHome
        leading={previewing ? undefined : <CompanySwitcher fallbackName={dashboard.data?.name} />}
        search={search}
        example={example}
        holdWrites={holdWrites}
      />,
    );
  }

  // The selected month's figures: Home's recent months, or an older month's year (its own read).
  const data = isCurrent ? cash.data : older.query.data;
  if (data == null) return withWeekly(<CashHomeSkeleton preview={previewing} example={example} />);

  const unpaidPhase = screenPhase(preview, unpaid);
  const unpaidGross = unpaidPhase.kind === "ready" ? unpaidOpenGross(unpaid.data ?? [], base) : 0n;
  const currentRow = cash.data.months.find((month) => cashMonthKey(month.month) === currentKey);
  const net = cashRows(currentRow, base).find((row) => row.currency === base)?.net_minor ?? 0n;
  const build = isCurrent ? monthForecast.data?.build ?? null : null;
  // The screen's big number: the cash net today, plus what is still to come in, less what is still to go out.
  // The row shows once the forecast is read, and only when something is still expected.
  const forecast = build == null || build.income.length + build.expense.length + build.small.length === 0
    ? null
    : net + build.incomeTotal - build.expenseTotal;
  const navigateTo = (key: string) => {
    void navigate(homeMonthPath(key, location.search, currentKey), { replace: true });
  };
  const weekly = previewing || !isCurrent ? null : cardWeek(today);
  const linesData = linesIn.data == null || linesOut.data == null ? null : [...(linesIn.data.pages[0]?.rows ?? []), ...(linesOut.data.pages[0]?.rows ?? [])];
  const activity: HomeActivityData | null = previewing || !isCurrent ? null : {
    schedule: schedule.data ?? null,
    scheduleFailed: schedule.isError,
    lines: linesData,
    linesFailed: linesIn.isError || linesOut.isError,
    onRetry: () => {
      if (schedule.isError) void schedule.refetch();
      if (linesIn.isError) void linesIn.refetch();
      if (linesOut.isError) void linesOut.refetch();
    },
  };

  return withWeekly(
    <CashHome
      data={data}
      monthKey={monthKey}
      currentKey={currentKey}
      firstKey={firstKey}
      previewing={previewing}
      search={search}
      attention={isCurrent ? attentionRows({
        pending: reviewWaiting(dashboard.data?.review_count ?? 0, jevBookings.data),
        transfers: transfers.data ?? 0,
        unpaidCount: unpaidPhase.kind === "ready" ? unpaidOpenRows(unpaid.data ?? []).length : 0,
        unpaidGross,
        currency: base,
        unpaidOther: unpaidPhase.kind === "ready" ? unpaidTotals(unpaid.data ?? []).filter((total) => total.currency !== base && total.minor !== 0n) : [],
        missingCount: late.expense,
        missingIncome: late.income,
        changes: chargeChangeViews(changes.data ?? [], search),
        search,
      }) : []}
      // A failed unpaid read, or a failed get_dashboard (the review count) once cash drew the books.
      attentionFailed={isCurrent && (unpaidPhase.kind === "error" || dashboardPhase.kind === "error")}
      onAttentionRetry={() => {
        if (unpaidPhase.kind === "error") void unpaid.refetch();
        if (dashboardPhase.kind === "error") void dashboard.refetch();
      }}
      sameDay={isCurrent ? sameDay.data ?? null : null}
      forecast={forecast}
      // FLOW-1031: until the forecast's read answers, the row keeps its place, so the attention box does not move.
      forecastPending={isCurrent && !previewing && monthForecast.data == null && !monthForecast.isError}
      onStepMonth={navigateTo}
      offlineSince={previewing || online ? null : cash.dataUpdatedAt}
      checklist={isCurrent ? <SetupHomeSlot emptyHome={false} /> : null}
      activity={activity}
      drawerNext={previewing || !isCurrent ? null : (
        <Suspense fallback={null}>
          <DrawerNextMonth today={today} currency={base} cash={cash.data} />
        </Suspense>
      )}
      lateRecurring={isCurrent ? late.expense + late.income : 0}
      recurringTip={recurringOwner}
      weekly={weekly == null || weeklyCardHidden(weekly) ? null : (
        <Suspense fallback={null}>
          <WeeklySummaryCardSlot weekStart={weekly} />
        </Suspense>
      )}
      company={previewing ? undefined : <CompanySwitcher fallbackName={dashboard.data?.name} />}
    />,
  );
}

/**
 * The band, the figures, the attention cards and the month's activity. `data` holds the selected month
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
  attentionFailed = false,
  onAttentionRetry,
  example,
  checklist,
  weekly,
  company,
  sameDay = null,
  forecast = null,
  forecastPending = false,
  onStepMonth,
  initialDrawerOpen = false,
  drawerYearMonths,
  syncing = null,
  offlineSince = null,
  activity = null,
  drawerNext = null,
  initialDrawerNext = false,
  initialFilter = "all",
  lateRecurring = 0,
  recurringTo,
  recurringTip = false,
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
  /** A read behind the attention box failed (unpaid, or the review count): a retry line above it. */
  attentionFailed?: boolean;
  onAttentionRetry?: () => void;
  /** Storybook sample label. The live home never passes it. */
  example?: ReactNode;
  checklist?: ReactNode;
  /** FLOW-956: last week's summary card, under the band (Sunday to Tuesday, the current month). */
  weekly?: ReactNode;
  /** FLOW-1036: the month's activity reads (the current month only); null draws no activity. */
  activity?: HomeActivityData | null;
  /** FLOW-1036: next month's forecast card, for the month drawer (the current month only). */
  drawerNext?: ReactNode;
  /** Stories open the drawer on next month. */
  initialDrawerNext?: boolean;
  /** Stories start on a filter. */
  initialFilter?: ActivityFilter;
  /** FLOW-986: late recurring bills and income, the count on the band's קבועים icon (FLOW-1017). */
  lateRecurring?: number;
  /** FLOW-986: where the קבועים icon and the activity's link go (the dev fixtures' own path). */
  recurringTo?: string;
  /** FLOW-987: may show the one-time tip under the band's קבועים icon. */
  recurringTip?: boolean;
  /** FLOW-601: the company's name, which opens the חברה sheet, on the band's row 1. */
  company?: ReactNode;
  /** FLOW-364: the previous month's figures up to today's day, from cash_month_to_day (the current month only). */
  sameDay?: CashToDay | null;
  /** FLOW-364: the forecast for the month's end, in the base currency, or null to hide the row. */
  forecast?: bigint | null;
  /** FLOW-1031: the forecast is still being read: its row's place is kept, with a bar for the figure. */
  forecastPending?: boolean;
  /** Steps Home to another month (the arrows, a swipe, the drawer). */
  onStepMonth: (key: string) => void;
  /** Stories open the drawer at once. */
  initialDrawerOpen?: boolean;
  /** Dev route: the drawer's year, in place of the live query. */
  drawerYearMonths?: NonNullable<CashMonths>;
  /** A background refresh runs: the strip over the band says what it syncs (the board's syncing frame). A fixture only for now: the live Home reads no sync status. */
  syncing?: string | null;
  /** FLOW-958: offline, when the figures shown were read (ms); null while online. */
  offlineSince?: number | null;
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
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen || initialDrawerNext);
  // FLOW-1036: the later arrow on the current month opens the drawer on next month.
  const [drawerOnNext, setDrawerOnNext] = useState(initialDrawerNext);
  const setDrawer = useSheetHistory("month", drawerOpen, setDrawerOpen);
  // A pick closes the drawer by its history pop. The month moves after that pop: a navigation sent
  // before it would be undone by the pop (FLOW-364).
  const pendingMonth = useRef<string | null>(null);
  useEffect(() => {
    if (drawerOpen || pendingMonth.current == null) return;
    const key = pendingMonth.current;
    pendingMonth.current = null;
    onStepMonth(key);
    // The sheet's close and the month's history entry restore the scroll they saved, so the top is set
    // again after both have run (FLOW-364).
    window.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
    });
  }, [drawerOpen, onStepMonth]);
  const nav: HomeMonthNav = {
    earlierKey,
    laterKey,
    onStep: onStepMonth,
    onOpenDrawer: () => {
      setDrawerOnNext(false);
      setDrawer(true);
    },
    onOpenNext: isPast || drawerNext == null ? undefined : () => {
      setDrawerOnNext(true);
      setDrawer(true);
    },
  };
  const compactShown = useBandGone();
  const animate = useMonthDirection(monthKey);
  // FLOW-1036: one filter in two places, the page and the bar's dock; a pick while docked brings the list's top under the bar.
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  const dockFilter = useDockedFilter({ barShown: compactShown && activity != null, bar: 64 });
  const pickFilter = (next: ActivityFilter) => {
    setFilter(next);
    dockFilter.scrollUnderBar();
  };

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <SyncStrip label={syncing} />
      <div className="m-page-enter" style={pageEnterStyle(0)}>
        <TopBand
          wordmark={false}
          preview={previewing}
          example={example}
          tone={isPast ? "past" : "current"}
          leading={company}
          trailing={<HomeBandActions isPast={isPast} currentName={monthName(currentKey)} search={search} lateRecurring={lateRecurring} recurringTo={recurringTo} recurringTip={recurringTip} />}
        >
          <div className="ui-band-body">
            {offlineSince == null ? null : <BandOfflineLine since={offlineSince} />}
            <HomeMonthPill monthKey={monthKey} nav={nav} />
            <HomeSwipeFigures monthKey={monthKey} figures={figures} search={search} nav={nav} animate={animate} />
            {isPast ? null : forecast != null ? (
              <Link to="/forecast" className="ui-home-forecast-link" aria-label="תזרים צפוי לסוף החודש">
                <ForecastRow monthKey={monthKey} minor={forecast} currency={base} />
              </Link>
            ) : forecastPending ? (
              <div className="ui-home-forecast-link" aria-hidden="true">
                <ForecastRow monthKey={monthKey} minor={null} currency={base} />
              </div>
            ) : null}
          </div>
        </TopBand>
      </div>

      {weekly}

      {attentionFailed ? (
        <div className="ui-page-pad">
          <FailureLine
            offline={false}
            onRetry={() => {
              onAttentionRetry?.();
            }}
          />
        </div>
      ) : null}
      {/* Design lead: Home shows money that needs a hand whatever its main figure; no rows, no section.
          FLOW-958: it comes right after the band, so the review card is above the fold. FLOW-1036: row-cards,
          each but the review hidden on this device until what it counts changes. */}
      <div className="m-page-enter" style={pageEnterStyle(1)}>
        {isPast || attention.length === 0 ? null : (
          <div className="ui-page-pad ui-home-attn">
            <AttentionCards rows={attention} storageKey="home" />
          </div>
        )}
        {checklist}
      </div>

      {activity == null ? null : (
        <div className="ui-page-pad m-page-enter" style={pageEnterStyle(2)}>
          <HomeActivity
            activity={activity}
            filter={filter}
            onFilter={pickFilter}
            markRef={dockFilter.markRef}
            docked={dockFilter.docked}
            base={base}
            search={search}
            recurringHref={`${recurringTo ?? "/recurring"}${search}`}
          />
        </div>
      )}

      <HomeCompactBar
        monthKey={monthKey}
        net={baseRow?.net_minor ?? 0n}
        currency={base}
        isPast={isPast}
        nav={nav}
        shown={compactShown}
        dock={activity == null ? undefined : <ActivityFilterControl value={filter} onChange={pickFilter} tone="band" />}
        docked={dockFilter.docked}
      />
      <MonthDrawer
        open={drawerOpen}
        onOpenChange={setDrawer}
        selectedKey={monthKey}
        firstKey={firstKey}
        base={base}
        yearMonths={drawerYearMonths}
        next={isPast ? null : drawerNext}
        openOnNext={drawerOnNext}
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
