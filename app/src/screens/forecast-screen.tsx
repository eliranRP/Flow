import { formatAmountText, type ForecastBuild, type ForecastItem, type ForecastOverrideRow } from "@flow/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cashMonthKey, cashRows } from "../cash";
import { daysLeftInMonth, type ForecastPatch, type MonthForecast, nextMonth, priorPatch, useMonthForecastQuery, useResetForecastMonth, useRestoreForecast, useSetForecastItem } from "../forecast-month";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { useCashMonthsQuery } from "../use-cash";
import { useGoBack } from "../ui/back";
import { israelToday } from "../ui/date-math";
import { ScreenHeader } from "../ui/screen-header";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { EmptyState } from "../ui/empty-state";
import { CalendarCheckIcon } from "../ui/icons";
import { useToast } from "../ui/toast";
import { ChangedLine, dayMonth, ForecastFootnote, itemWhat, itemWhen, MovedRow, signed } from "./forecast-parts";
import { forecastCategories, type ForecastSoFar, useForecastSoFarQuery } from "./forecast-categories";
import { ForecastCategoryView, type ForecastView, ForecastViewSwitch } from "./forecast-category-view";
import { ForecastItemPage } from "./forecast-item-page";
import { monthName } from "./home-parts";
import { Amount } from "../ui/amount";
import { NO_CATEGORY } from "../recurring-layout";
import { cx } from "../ui/cx";

/**
 * A story's data: the builder's output (in `data.base`, the currency it counted) and the cash net today, in its minor units.
 * `soFar` is the month by category for לפי קטגוריה; `view` and `openCategories` are where a frame opens.
 */
export type ForecastSample = {
  data: MonthForecast;
  net: bigint;
  today: string;
  soFar?: ForecastSoFar;
  view?: ForecastView;
  openCategories?: readonly string[];
};

const NO_SO_FAR: ForecastSoFar = { income: [], expense: [] };

/** The page scrolls past this many pixels: the compact bar slides down (FLOW-141). */
const COMPACT_AFTER = 150;
/** The moved row folds away this long before its write, then the list is refreshed. */
const FOLD_MS = 280;

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

function ForecastRowButton({ item, today, onOpen, leaving }: { item: ForecastItem; today: string; onOpen: (item: ForecastItem) => void; leaving: boolean }) {
  const name = item.name === "" ? "ללא שם" : item.name;
  const amount = item.direction === "income" ? signed(item.minor, "+", item.currency) : signed(item.minor, "−", item.currency);
  const figure = <Amount agorot={item.minor} size="list" currency={item.currency} direction={item.direction} income={item.direction === "income"} />;
  return (
    <li className={cx("ui-forecast-li", leaving && "ui-forecast-leaving")}>
      <button type="button" className="ui-forecast-row" data-forecast-key={item.key} onClick={() => { onOpen(item); }} aria-label={`${name}, ${amount}`}>
        <span className="ui-forecast-initial" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="ui-forecast-text">
          <span className="ui-forecast-name">{name}</span>
          <span className="ui-forecast-meta">{`${itemWhat(item)} · ${itemWhen(item, today)}`}</span>
        </span>
        <span className={cx("ui-forecast-amount", item.overridden && "ui-forecast-edited")}>{figure}</span>
      </button>
    </li>
  );
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
  const write = useSetForecastItem(month);
  const reset = useResetForecastMonth(month);
  const restore = useRestoreForecast(month);
  const [smallOpen, setSmallOpen] = useState(false);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState<ForecastView>(sample?.view ?? "items");
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(() => new Set(sample?.openCategories ?? []));

  const data = sample?.data ?? query.data ?? null;
  const base = data?.base ?? "ILS";
  const currentRow = cash.data?.months.find((row) => cashMonthKey(row.month) === month);
  const net = sample?.net ?? cashRows(currentRow, base).find((row) => row.currency === base)?.net_minor ?? 0n;
  const build: ForecastBuild | null = data?.build ?? null;
  const total = build == null ? 0n : net + build.incomeTotal - build.expenseTotal;
  const days = daysLeftInMonth(today, month);
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
  const projects = useDashboardQuery(live && open?.project_id != null);
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

  useEffect(() => {
    const onScroll = () => { setCompact(window.scrollY > COMPACT_AFTER); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); };
  }, []);

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
  function leave(item: ForecastItem, patch: ForecastPatch, prior: ForecastOverrideRow | null) {
    setLeavingKey(item.key);
    window.setTimeout(() => {
      setLeavingKey(null);
      write.mutate({ key: item.key, patch, undo: false, prior });
    }, FOLD_MS);
  }

  function save(item: ForecastItem, patch: ForecastPatch) {
    const prior = data?.overrides.find((row) => row.item_key === item.key) ?? null;
    if (patch.moved_out) {
      if (openKey == null) leave(item, patch, prior);
      else pendingLeave.current = () => { leave(item, patch, prior); };
      toast.show({
        message: `${item.name} הועבר לחודש הבא`,
        action: "ביטול",
        onAction: () => { write.mutate({ key: item.key, patch: priorPatch(prior), undo: true, prior }); },
      });
      return;
    }
    write.mutate({ key: item.key, patch, undo: false, prior });
    toast.show({
      message: "הצפי עודכן",
      action: "ביטול",
      onAction: () => { write.mutate({ key: item.key, patch: priorPatch(prior), undo: true, prior }); },
    });
  }

  /** The reset clears every override; the undo sends the captured ones back (FLOW-141b). */
  function resetAll() {
    const before = data?.overrides ?? [];
    reset.mutate(undefined, {
      onSuccess: () => {
        toast.show({ message: "הצפי חזר לחישוב של Flow", action: "ביטול", onAction: () => { restore.mutate(before); } });
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
        <ScreenHeader className="ui-tab-root-head" title="צפי" backTo="/" backText="בית" subtitle={`${monthName(month)} · נכון ל־${today.slice(8, 10)}/${today.slice(5, 7)}`} />
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

  return (
    <div className={cx("ui-forecast-screen", open != null && "ui-forecast-screen-paged")}>
      <div className={cx("ui-forecast-compact", compact && "ui-forecast-compact-on")} aria-hidden={!compact}>
        <span>בית</span>
        <span className="ui-forecast-compact-figure">צפי · <bdi dir="ltr">{forecastBigText(total, base)}</bdi></span>
      </div>
      <ScreenHeader title="צפי" backTo="/" backText="בית" subtitle={`סוף ${monthName(month)} · עוד ${String(days)} ימים`} />
      {data == null && live && query.isError ? (
        <p className="ui-forecast-error t-caption t-muted" role="alert">לא הצלחנו לטעון את הצפי.</p>
      ) : null}
      {data == null && !query.isError ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : null}
      {build == null ? null : (
        <>
          <p className={cx("ui-forecast-big", total < 0n && "ui-forecast-big-neg")} aria-label="הצפי לסוף החודש">
            <Amount agorot={total} size="display" currency={base} />
          </p>
          <p className="ui-forecast-today">היום <bdi dir="ltr">{forecastBigText(net, base)}</bdi></p>
          <ChangedLine changed={changed} onReset={resetAll} />
          <ForecastViewSwitch view={view} onPick={setView} />
          {byCategory ? (
            soFar == null ? (
              live && soFarQuery.isError ? (
                <p className="ui-forecast-error t-caption t-muted" role="alert">לא הצלחנו לטעון את הקטגוריות.</p>
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
                  <li className="ui-forecast-li">
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
