import { type CashMonths, type CashToDay } from "@flow/shared";
import { SyncStrip } from "../ui/sync-strip";
import { cashHasBooks, dashboardHasBooks } from "../by-currency";
import { onlineManager } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { unpaidOpenGross, unpaidOpenRows, unpaidTotals } from "../unpaid";
import { useAuth } from "../auth";
import { cashMonthKey, cashRows, profitPath, shownCashRows } from "../cash";
import { useCashMonthData, useCashMonthsQuery, useCashYearsQuery } from "../use-cash";
import { useCashToDayQuery } from "../use-cash-to-day";
import { Amount } from "../ui/amount";
import { useSheetHistory } from "../ui/back";
import { pageEnterStyle } from "../ui/motion";
import { israelToday } from "../ui/date-math";
import { monthPeriod, shiftMonthKey } from "../period";
import { homeMonthKey, homeMonthPath, forecastMinor } from "../home-month";
import { HomeBandActions, HomeCompactBar, HomeMonthPill, HomeSwipeFigures, SplitCard, AttentionBox, ForecastRow, homeMonthLabel, monthName, type HomeFigureRows, type HomeMonthNav } from "./home-parts";
import { MonthDrawer } from "./month-drawer";
import type { BannerRow } from "../ui/banner";
import { Button } from "../ui/button";
import { FailureLine } from "../ui/empty-state";
import { BankIcon } from "../ui/icons";
import { CashHomeSkeleton } from "./home-skeleton";
import { TopBand, useBandGone } from "../ui/top-band";
import { previewHidesBand, useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldOwnerSettings } from "../use-is-viewer";
import { CompanySwitcher } from "./company-switcher";
import { useDashboardQuery, useOptionalBooks, useUnpaidQuery } from "../use-books";
import { SetupHomeSlot } from "../setup/home";
import { chargeChangeViews, lateCounts, openMonthDue, useCompanyExpectedQuery, useMissingBillsQuery, useRecurringChangesQuery } from "../forecast";
import { attentionRows } from "./attention-rows";
import { useTransferMatchCountQuery } from "../transfer-match-count";
import { reviewWaiting, useJevBookingCountQuery } from "../jev-booking-count";

export { attentionRows };

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
  // Home waits on cash_months alone when it holds a line. Only a company with no recent line
  // waits for get_dashboard too, so the empty state never shows before Flow knows.
  const cashBooks = cashPhase.kind === "ready" && cash.data != null && cashHasBooks(cash.data);
  const dashboardGate = cashBooks ? null : dashboardPhase;
  const errorPhase = cashPhase.kind === "error" ? cashPhase : dashboardGate?.kind === "error" ? dashboardGate : null;
  const ready = cashPhase.kind === "ready" && (cashBooks || dashboardPhase.kind === "ready");
  const showBooks = ready && cash.data != null && (cashBooks || (dashboard.data != null && dashboardHasBooks(dashboard.data)));
  const loading = errorPhase == null && (cashPhase.kind === "loading" || dashboardGate?.kind === "loading" || (!previewing && status === "loading" && !showBooks));
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
    return <FailureLine offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks || cash.data == null) {
    // FLOW-601: connecting a bank or SUMIT is the owner's.
    return (
      <CashEmptyHome
        leading={previewing ? undefined : <CompanySwitcher fallbackName={dashboard.data?.name} />}
        search={search}
        example={example}
        holdWrites={holdWrites}
      />
    );
  }

  // The selected month's figures: Home's recent months, or an older month's year (its own read).
  const data = isCurrent ? cash.data : older.query.data;
  if (data == null) return <CashHomeSkeleton preview={previewing} example={example} />;

  const unpaidPhase = screenPhase(preview, unpaid);
  const unpaidGross = unpaidPhase.kind === "ready" ? unpaidOpenGross(unpaid.data ?? [], base) : 0n;
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
      forecast={forecast != null && forecast.show ? forecast.minor : null}
      onStepMonth={navigateTo}
      checklist={isCurrent ? <SetupHomeSlot emptyHome={false} /> : null}
      company={previewing ? undefined : <CompanySwitcher fallbackName={dashboard.data?.name} />}
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
  attentionFailed = false,
  onAttentionRetry,
  example,
  checklist,
  company,
  sameDay = null,
  forecast = null,
  onStepMonth,
  initialDrawerOpen = false,
  drawerYearMonths,
  syncing = null,
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
  /** Dev route: the drawer's year, in place of the live query. */
  drawerYearMonths?: NonNullable<CashMonths>;
  /** A background refresh runs: the strip over the band says what it syncs (the board's syncing frame). A fixture only for now: the live Home reads no sync status. */
  syncing?: string | null;
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
      setDrawer(true);
    },
  };
  const compactShown = useBandGone();
  const animate = useMonthDirection(monthKey);
  const books = useOptionalBooks();
  const navigate = useNavigate();
  const openProfit = () => {
    books?.setPeriod(monthPeriod(monthKey));
    void navigate(profitPath(monthKey, search));
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
          trailing={<HomeBandActions isPast={isPast} currentName={monthName(currentKey)} search={search} />}
        >
          <div className="ui-band-body">
            <HomeMonthPill monthKey={monthKey} nav={nav} />
            <HomeSwipeFigures monthKey={monthKey} figures={figures} search={search} nav={nav} animate={animate} />
            {isPast || forecast == null ? null : (
              <Link to="/forecast" className="ui-home-forecast-link" aria-label="תזרים צפוי לסוף החודש">
                <ForecastRow monthKey={monthKey} minor={forecast} currency={base} />
              </Link>
            )}
          </div>
        </TopBand>
      </div>

      {baseRow == null ? null : (
        <div className="m-page-enter" style={pageEnterStyle(1)}>
          <SplitCard monthKey={monthKey} row={baseRow} search={search} onOpenProfit={openProfit} />
        </div>
      )}

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
        yearMonths={drawerYearMonths}
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
