import "../ui/lazy.css";
import { formatAmountText, type ForecastBuild, type ForecastItem, type ForecastOverrideRow } from "@flow/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cashMonthKey, cashRows } from "../cash";
import { daysLeftInMonth, type ForecastPatch, nextMonth, priorPatch, useResetForecastMonth, useRestoreForecast, useSetForecastItem } from "../forecast-month";
import { type MonthForecast, useMonthForecastQuery } from "../month-forecast-query";
import { expenseCountNote, incomeCountNote, itemsCaption, monthEndChart, monthEndTakeaway } from "../forecast-chart";
import { CHART_MONTHS, cashMonthFigures, type MonthFigures } from "../month-figures";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { useCashMonthsQuery } from "../use-cash";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { israelToday } from "../ui/date-math";
import { BackButton, useGoBack } from "../ui/back";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { FocusTitle } from "../ui/focus-title";
import { DETAIL_BAR, ScreenHeader, useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { NextMonthCardSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { EmptyState } from "../ui/empty-state";
import { CalendarCheckIcon } from "../ui/icons";
import { useToast } from "../ui/toast";
import { ChangedLine, dayMonth, FORECAST_TITLE, ForecastFootnote, ForecastRowButton, MovedRow, signed } from "./forecast-parts";
import { ForecastProjectView } from "./forecast-project-view";
import { addLineReady, ForecastAddLine, lineProjects } from "./forecast-add-line";
import { useOverheadProject } from "../overhead-project";
import { type ForecastProject, forecastProjects } from "../forecast-projects";
import { forecastCategories, type ForecastSoFar, useForecastSoFarQuery } from "./forecast-categories";
import { FORECAST_VIEWS, ForecastCategoryView, type ForecastView } from "./forecast-category-view";
import { ForecastItemPage } from "./forecast-item-page";
import { monthName } from "./home-parts";
import { Amount } from "../ui/amount";
import { ForecastCard, MonthChart } from "../ui/month-forecast";
import { NO_CATEGORY } from "../recurring-layout";
import { cx } from "../ui/cx";
import { topToast } from "../ui/top-toast";

/**
 * A story's data: the builder's output (in `data.base`, the currency it counted) and the cash net today, in its minor units.
 * `months` is the chart's cash months by yyyy-mm (the current one to date); `soFar` is the month by category for
 * לפי קטגוריה; `view` and `openCategories` are where a frame opens. `failed` draws the forecast's failed read,
 * and `offlineSince` the offline line from that moment (FLOW-970).
 */
export type ForecastSample = {
  data: MonthForecast;
  net: bigint;
  today: string;
  months?: ReadonlyMap<string, MonthFigures>;
  soFar?: ForecastSoFar;
  view?: ForecastView;
  openCategories?: readonly string[];
  /** לפי פרויקט's names and order (the dashboard's projects, live). */
  projects?: readonly ForecastProject[];
  failed?: boolean;
  offlineSince?: number;
};

const NO_SO_FAR: ForecastSoFar = { income: [], expense: [] };

/** The moved row folds away this long before its write, then the list is refreshed. */
const FOLD_MS = 280;

/** A move to next month that waits for its fold: ביטול before it is sent cancels it, after it sends the undo. */
type PendingMove = { sent: boolean; cancelled: boolean; timer: number | null };

/** `<list path>/item/<key>`: a row's page is open over the list (MonthForecastEdit). */
const ITEM_PATH = /^(.*?)\/item\/([^/]+)\/?$/;

function decodeKey(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** The big number: the sign is U+2212 when it is negative, as Home's line writes it. */
export function forecastBigText(minor: bigint, currency = "ILS"): string {
  return minor < 0n ? signed(minor, "−", currency) : formatAmountText(minor, currency);
}

function ForecastSection({
  title,
  total,
  items,
  today,
  onOpen,
  leavingKey,
}: {
  title: string;
  total: ReactNode;
  items: readonly ForecastItem[];
  today: string;
  onOpen: (item: ForecastItem) => void;
  leavingKey: string | null;
}) {
  return (
    <section className="ui-forecast-section">
      <h2 className="ui-forecast-section-head">
        <span>{title}</span>
        <span className="ui-forecast-section-total">{total}</span>
      </h2>
      <ul className="ui-forecast-list">
        {items.map((item) => (
          <ForecastRowButton key={item.key} item={item} today={today} onOpen={onOpen} leaving={leavingKey === item.key} />
        ))}
      </ul>
    </section>
  );
}

/**
 * FLOW-141: the month-end forecast. A row opens its page at `<this path>/item/<key>`, over the list,
 * which stays mounted under it. `openWhen` opens the page's When sheet with it (the dev route's frame).
 */
export function ForecastScreen({ sample, openWhen = false }: { sample?: ForecastSample; openWhen?: boolean } = {}) {
  const toast = useToast();
  const live = sample == null;
  const today = sample?.today ?? israelToday();
  const month = today.slice(0, 7);
  const query = useMonthForecastQuery(month, live);
  const cash = useCashMonthsQuery();
  // The chart's six months: Home's read holds four, so the chart has its own (one read, under "dashboard").
  const chartCash = useCashMonthsQuery(live, CHART_MONTHS);
  const write = useSetForecastItem(month);
  const reset = useResetForecastMonth(month);
  const restore = useRestoreForecast(month);
  const [smallOpen, setSmallOpen] = useState(false);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  // FLOW-1048 (V3-Forecast): the 56px bar comes down once the head has gone under it, and the views dock into it.
  const [headEnd, setHeadEnd] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(headEnd, true, DETAIL_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: DETAIL_BAR });
  const [view, setView] = useState<ForecastView>(sample?.view ?? "items");
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(() => new Set(sample?.openCategories ?? []));
  const online = useOnline();

  const data = sample?.data ?? query.data ?? null;
  const base = data?.base ?? "ILS";
  const currentRow = cash.data?.months.find((row) => cashMonthKey(row.month) === month);
  const net = sample?.net ?? cashRows(currentRow, base).find((row) => row.currency === base)?.net_minor ?? 0n;
  // Today's cash is the sum's start: with no read of this month (loading, offline, a failed read), no figure is shown.
  const startKnown = sample != null || currentRow != null;
  const build: ForecastBuild | null = data?.build ?? null;
  const total = build == null ? 0n : net + build.incomeTotal - build.expenseTotal;
  const days = daysLeftInMonth(today, month);
  const chartFigures = sample != null ? sample.months ?? null : chartCash.data == null ? null : cashMonthFigures(chartCash.data, base);
  const chart = build == null || chartFigures == null ? null : monthEndChart(month, chartFigures, { incomeMinor: build.incomeTotal, expenseMinor: build.expenseTotal }, base);
  // FLOW-970: a failed read says what happened, with the retry and the way to help; offline, the last figures stay with their moment.
  const failed = sample?.failed ?? (data == null && query.isError);
  const offlineSince = live ? (online || data == null ? undefined : query.dataUpdatedAt || undefined) : sample.offlineSince;
  const byCategory = view === "categories";
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const itemPath = ITEM_PATH.exec(pathname);
  const listPath = itemPath?.[1] ?? pathname.replace(/\/$/, "");
  const listTo = `${listPath}${search}`;
  const openKey = itemPath?.[2] == null ? null : decodeKey(itemPath[2]);
  const open = openKey == null ? null : build?.items.find((item) => item.key === openKey) ?? null;
  const soFarQuery = useForecastSoFarQuery(month, base, live && byCategory && data != null);
  const categories = useCategoriesQuery(live && (byCategory || open?.category_id != null));
  const byProject = view === "projects";
  // The projects name לפי פרויקט's sections, the item page's project and the add row's sheet (FLOW-1006).
  const projects = useDashboardQuery(live);
  const overhead = useOverheadProject(live);
  const overheadId = overhead.project?.id ?? null;
  const projectList: ForecastProject[] = sample?.projects?.slice()
    ?? (projects.data?.projects ?? []).map(({ id, name, status }) => ({ id, name, status, is_overhead: id === overheadId }));
  const addTo = lineProjects(projectList, overheadId);
  // FLOW-1013: with one place to add to, the button names it (there is no sheet to ask).
  const onlyTo = addTo.length === 1 ? addTo[0] : undefined;
  // A sample with no month by category draws its categories with nothing so far, never a skeleton that stays.
  const soFar = live ? soFarQuery.data ?? null : sample.soFar ?? NO_SO_FAR;
  // The row that opened the page takes the focus back when it closes.
  const opener = useRef<string | null>(null);
  /** A move to next month saved on the page: its row folds once the list is back on screen. */
  const pendingLeave = useRef<(() => void) | null>(null);

  /** Where the list was scrolled when a row's page opened: the page starts at the top, the list comes back here. */
  const listScroll = useRef<number | null>(null);

  function openItem(item: ForecastItem) {
    opener.current = item.key;
    listScroll.current = window.scrollY;
    void navigate(`${listPath}/item/${encodeURIComponent(item.key)}${search}`);
  }

  // A key that is not in the month (an old link, or an item that arrived) goes back to the list.
  const missing = openKey != null && build != null && open == null;
  useEffect(() => {
    if (missing) void navigate(listTo, { replace: true });
  }, [missing, listTo, navigate]);

  useEffect(() => {
    if (openKey != null) return;
    const fold = pendingLeave.current;
    pendingLeave.current = null;
    // Two frames: the list is drawn again before its row starts to fold.
    if (fold != null) requestAnimationFrame(() => { requestAnimationFrame(fold); });
    const scroll = listScroll.current;
    listScroll.current = null;
    if (scroll != null && window.scrollY !== scroll) window.scrollTo(0, scroll);
    if (opener.current == null) return;
    const key = opener.current;
    opener.current = null;
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-forecast-key]")).find((node) => node.dataset.forecastKey === key);
    row?.focus({ preventScroll: true });
  }, [openKey]);

  function toggleCategory(key: string) {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const smallTotal = build == null ? 0n : build.small.reduce((sum, item) => sum + item.minor, 0n);
  const changed = build?.changed ?? 0;
  const smallUntil = build?.small.reduce<string | null>((latest, item) => { const day = item.due_on ?? item.expected_on; return day != null && (latest == null || day > latest) ? day : latest; }, null) ?? null;

  /** The row folds away, then the move is written; the page has closed first, so the list shows the fold. */
  function leave(item: ForecastItem, patch: ForecastPatch, prior: ForecastOverrideRow | null, move: PendingMove) {
    if (move.cancelled) return;
    setLeavingKey(item.key);
    move.timer = window.setTimeout(() => {
      move.timer = null;
      setLeavingKey(null);
      move.sent = true;
      write.mutate({ key: item.key, patch, undo: false, prior });
    }, FOLD_MS);
  }

  /** `alsoUndo` (FLOW-1018): another write of the same save (the line's pace), undone by this toast's ביטול after the month's change. */
  function save(item: ForecastItem, patch: ForecastPatch, alsoUndo?: () => void) {
    const prior = data?.overrides.find((row) => row.item_key === item.key) ?? null;
    if (patch.moved_out) {
      const move: PendingMove = { sent: false, cancelled: false, timer: null };
      const fold = () => { leave(item, patch, prior, move); };
      if (openKey == null) fold();
      else pendingLeave.current = fold;
      toast.show(topToast({
        message: `${item.name} הועבר לחודש הבא`,
        action: "ביטול",
        onAction: () => {
          if (move.sent) {
            write.mutate({ key: item.key, patch: priorPatch(prior), undo: true, prior });
          } else {
            // A ביטול inside the fold, or before the page has closed: the move was never sent, so nothing is.
            move.cancelled = true;
            if (move.timer != null) window.clearTimeout(move.timer);
            if (pendingLeave.current === fold) pendingLeave.current = null;
            setLeavingKey((key) => (key === item.key ? null : key));
          }
          alsoUndo?.();
        },
      }));
      return;
    }
    write.mutate({ key: item.key, patch, undo: false, prior });
    toast.show(topToast({
      message: "הצפי עודכן",
      action: "ביטול",
      onAction: () => {
        write.mutate({ key: item.key, patch: priorPatch(prior), undo: true, prior });
        alsoUndo?.();
      },
    }));
  }

  /** The reset clears every override; the undo sends the captured ones back (FLOW-141b). */
  function resetAll() {
    const before = data?.overrides ?? [];
    reset.mutate(undefined, {
      onSuccess: () => {
        toast.show(topToast({ message: "הצפי חזר לחישוב של Flow", action: "ביטול", onAction: () => { restore.mutate(before); } }));
      },
    });
  }

  const income = build?.income ?? [];
  const expense = build?.expense ?? [];
  const moved = build?.moved ?? [];

  // Everything arrived: the header, the calendar icon and the copy only (FLOW-141b, StatesForecastEmpty).
  if (build != null && income.length + expense.length + build.small.length === 0 && moved.length === 0) {
    return (
      <div className="ui-forecast-screen">
        <ScreenHeader className="ui-tab-root-head" title={FORECAST_TITLE} backTo="/" backText="בית" subtitle={`${monthName(month)} · נכון ל־${today.slice(8, 10)}/${today.slice(5, 7)}`} />
        <div className="ui-forecast-empty">
          <EmptyState
            icon={<CalendarCheckIcon />}
            title="הכל כבר הגיע"
            body={`כל החיובים וההכנסות הצפויים ל${monthName(month)} נכנסו לחשבון. הצפי ל${monthName(nextMonth(month))} ייפתח ב־1 בחודש.`}
          />
        </div>
      </div>
    );
  }

  const categoryNames = new Map<string, string>([
    ...[...soFar?.income ?? [], ...soFar?.expense ?? []].flatMap((row): Array<[string, string]> => (row.name == null ? [] : [[row.key, row.name]])),
    ...(categories.data ?? []).map((row): [string, string] => [row.id, row.name]),
  ]);
  // A name still loading shows nothing, never "כללי" or "ללא קטגוריה" for a moment.
  const projectName = open == null
    ? ""
    : open.project_name ?? (open.project_id == null ? "כללי" : live && projects.isPending ? "" : projects.data?.projects.find((row) => row.id === open.project_id)?.name ?? "כללי");
  const categoryName = open?.category_id == null
    ? NO_CATEGORY
    : categoryNames.get(open.category_id) ?? (live && categories.isPending ? "" : NO_CATEGORY);

  // FLOW-1048: the views as the one segmented control, in the page and, once it reaches the bar, docked in it.
  const viewSwitch = (
    <SegmentedControl<ForecastView>
      label="תצוגה לפי"
      showLabel={false}
      value={view}
      options={FORECAST_VIEWS}
      onChange={(next) => {
        setView(next);
        scrollUnderBar();
      }}
    />
  );

  return (
    <div className={cx("ui-forecast-screen", open != null && "ui-forecast-screen-paged")}>
      <CompactBar
        title={FORECAST_TITLE}
        figure={startKnown && build != null && !failed ? forecastBigText(total, base) : undefined}
        label="בית"
        backTo="/"
        size="detail"
        shown={barShown}
        dock={build == null || failed ? undefined : viewSwitch}
        docked={docked}
      />
      {/* FLOW-1048 (V3-Forecast, Overview-lite): Back, the title and the month's line; the figure under them. */}
      <header className="ui-forecast-head">
        <BackButton fallback="/" text="בית" />
        <FocusTitle className="t-title">{FORECAST_TITLE}</FocusTitle>
        <p className="ui-forecast-sub t-meta">{`סוף ${monthName(month)} · עוד ${String(days)} ימים`}</p>
        <span ref={setHeadEnd} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {/* A sample has no read to retry: its failure is fixed, so נסו שוב does nothing there. */}
      {failed ? <PageLoadFailed title="הצפי לא נטען" offline={!online} onRetry={() => { if (live) void query.refetch(); }} /> : null}
      {offlineSince == null || failed ? null : <BandOfflineLine since={offlineSince} onPage />}
      {data == null && !failed ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : null}
      {build == null || failed ? null : (
        <>
          {!startKnown ? (
            // A read that failed, or came back without this month (no company, a month the server has not opened), says so.
            cash.isError || cash.isSuccess ? (
              <PageLoadFailed title="התזרים של היום לא נטען" offline={!online} onRetry={() => void cash.refetch()} />
            ) : (
              <DelayedSkeleton><NextMonthCardSkeleton /></DelayedSkeleton>
            )
          ) : (
          <>
          <p className={cx("ui-forecast-big", total < 0n && "ui-forecast-big-neg")} aria-label="תזרים צפוי לסוף החודש">
            <Amount agorot={total} size="display" currency={base} />
          </p>
          {/* The whole sum: today's cash, what is still expected in and out, and the month's end (the big figure). */}
          <div className="ui-fc-block ui-forecast-fc">
            <ForecastCard
              title={`עד סוף ${monthName(month)}`}
              kind="cash"
              currency={base}
              start={{ label: "תזרים היום", minor: net }}
              incomeMinor={build.incomeTotal}
              expenseMinor={build.expenseTotal}
              incomeNote={incomeCountNote(build, today)}
              expenseNote={expenseCountNote(build)}
              netLabel={`תזרים בסוף ${monthName(month)}`}
              strong
              caption={itemsCaption(build)}
            />
            {chart == null ? null : <MonthChart kind="cash" history={chart.months} forecast={null} sub={chart.sub} label={chart.label} takeaway={monthEndTakeaway(month, total, base)} />}
          </div>
          </>
          )}
          <ChangedLine changed={changed} onReset={resetAll} />
          <div className="ui-forecast-views">
            <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
            <DockSlot docked={docked}>{viewSwitch}</DockSlot>
          </div>
          {byProject ? (
            // In preview the read is off (no fetch at all): the view draws with no names, everything as general.
            live && projects.data == null && projects.fetchStatus !== "idle" ? (
              projects.isError ? (
                <PageLoadFailed title="הפרויקטים לא נטענו" offline={!online} onRetry={() => void projects.refetch()} />
              ) : (
                <DelayedSkeleton>
                  <ListSkeleton />
                </DelayedSkeleton>
              )
            ) : (
              <ForecastProjectView
                groups={forecastProjects(build, projectList)}
                currency={base}
                today={today}
                onOpenItem={openItem}
                leavingKey={leavingKey}
              />
            )
          ) : byCategory ? (
            soFar == null ? (
              live && soFarQuery.isError ? (
                <PageLoadFailed title="הקטגוריות לא נטענו" offline={!online} onRetry={() => void soFarQuery.refetch()} />
              ) : (
                <DelayedSkeleton>
                  <ListSkeleton />
                </DelayedSkeleton>
              )
            ) : (
              <ForecastCategoryView
                sides={forecastCategories(build, soFar, new Map((categories.data ?? []).map((row) => [row.id, row.name])), today)}
                currency={base}
                today={today}
                open={openCategories}
                onToggle={toggleCategory}
                onOpenItem={openItem}
                search={search}
              />
            )
          ) : (
            <>
            <ForecastSection
              title="צפוי להיכנס"
              total={<Amount agorot={build.incomeTotal} size="list" currency={base} direction="income" income />}
              items={income}
              today={today}
              onOpen={openItem}
              leavingKey={leavingKey}
            />
            <section className="ui-forecast-section">
              <h2 className="ui-forecast-section-head">
                <span>צפוי לצאת</span>
                <span className="ui-forecast-section-total ui-forecast-total-out"><bdi dir="ltr">{formatAmountText(build.expenseTotal, base)}</bdi></span>
              </h2>
              <ul className="ui-forecast-list">
                {expense.map((item) => (
                  <ForecastRowButton key={item.key} item={item} today={today} onOpen={openItem} leaving={leavingKey === item.key} />
                ))}
                {build.small.length > 0 ? (
                  <li className="ui-forecast-li ui-forecast-li-group">
                    <button type="button" className="ui-forecast-row ui-forecast-small" aria-expanded={smallOpen} onClick={() => { setSmallOpen((value) => !value); }}>
                      <span className="ui-forecast-initial" aria-hidden="true">{`+${String(build.small.length)}`}</span>
                      <span className="ui-forecast-text">
                        <span className="ui-forecast-name">חיובים קבועים קטנים</span>
                        <span className="ui-forecast-meta">{`${build.small.length === 1 ? "חיוב אחד" : `${String(build.small.length)} חיובים`}${smallUntil == null ? "" : ` · עד ${dayMonth(smallUntil)}`}`}</span>
                      </span>
                      <span className="ui-forecast-amount"><Amount agorot={smallTotal} size="list" currency={base} direction="expense" /></span>
                    </button>
                    {smallOpen ? (
                      <ul className="ui-forecast-small-list">
                        {build.small.map((item) => (
                          <ForecastRowButton key={item.key} item={item} today={today} onOpen={openItem} leaving={false} />
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ) : null}
              </ul>
            </section>
            {moved.length > 0 ? (
              <section className="ui-forecast-section ui-forecast-section-moved">
                <h2 className="ui-forecast-section-head ui-forecast-head-moved">לא החודש</h2>
                <ul className="ui-forecast-list">
                  {moved.map((item) => (
                    <MovedRow key={item.key} item={item} onOpen={openItem} />
                  ))}
                </ul>
              </section>
            ) : null}
            </>
          )}
          {!addLineReady(live, projects.data != null, overhead) ? null : <ForecastAddLine month={month} projects={addTo} search={search} {...(onlyTo == null ? {} : { label: `הוספת קטגוריה לצפי של ${onlyTo.name}` })} />}
          <ForecastFootnote />
        </>
      )}
      {open == null ? null : (
        <ForecastItemPage
          key={open.key}
          item={open}
          today={today}
          backTo={listTo}
          projectName={projectName}
          categoryName={categoryName}
          openWhen={openWhen}
          onSave={save}
          onClose={() => { goBack(listTo); }}
        />
      )}
    </div>
  );
}
