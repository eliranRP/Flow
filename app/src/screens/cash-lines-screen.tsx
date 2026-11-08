import "../ui/lazy.css";
import { type CashLine, type CashMonths, formatAmountText } from "@flow/shared";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  type CashListSide,
  cashLineSplit,
  cashLinesPath,
  cashMonthKey,
  cashMonthName,
  cashSideLabel,
  cashTitle,
  isCashMonthKey,
  isCashSide,
  shownCashRows,
} from "../cash";
import {
  groupLines,
  LINES_ORDER_LABEL,
  LINES_ORDERS,
  lineInitials,
  linesKnowRecurring,
  lineTagReason,
  linesOrder,
  linesSummary,
  type LinesOrder,
} from "../cash-lines-groups";
import { homeMonthPath } from "../home-month";
import { useHeldOrder } from "../list-hold";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useCashLinesQuery, useCashMonthData } from "../use-cash";
import { useCachedProjectName, useProjectCashMonthsQuery, withProjectSearch } from "../project-cash";
import { BandOfflineLine, PageLoadFailed, ReviewButton, useOnline } from "../ui/band-states";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { lineTagText, rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { BackButton } from "../ui/back";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { DETAIL_BAR, useScrolledPast } from "../ui/screen-header";
import { LinesSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { SplitPartsHint } from "../ui/split-parts-hint";
import { txnListState } from "../txn-nav";
import { reviewItems, reviewMinutes } from "../weekly-summary";
import { OrderChips } from "../ui/order-chips";
import { CashCurrencySwitch, CashLinesEmpty, CashLinesHead, linesCountParts, LinesTotal, cashLinesFigures } from "./cash-lines-parts";

/**
 * FLOW-366, FLOW-1048 (V3-Lines, the List pattern). The lines behind one month's נכנס or יצא (or FLOW-418 the
 * cash profit leaves out), in the order ?order= picks: Back, the title, the month line and the figure; the side
 * and currency segments, which dock into the 56px bar once they reach it; the order chips; then groups under
 * one-line sticky heads, with every page loaded up front.
 */

function lineSign(side: CashListSide, row: CashLine): "in" | "out" | "cost" {
  const back = row.amount_minor < 0n;
  if (side === "in") return back ? "out" : "in";
  if (side === "out") return back ? "in" : "cost";
  return (row.side === "in") !== back ? "in" : "out";
}

/**
 * `today` pins the day heads ("היום") for a sample whose lines are dated around a fixed day; `offlineSince`
 * draws the offline line from that moment (FLOW-965).
 */
type LinesSample = { months: NonNullable<CashMonths>; lines: CashLine[]; today?: string; offlineSince?: number };

export function CashLinesScreen({ sample, at }: { sample?: LinesSample; at?: { month: string; side: CashListSide; currency: string } } = {}) {
  const params = useParams();
  const month = at?.month ?? params.month;
  const side = at?.side ?? params.side;
  const currency = at?.currency ?? params.currency ?? "";
  const search = usePreviewSearch();
  if (!isCashMonthKey(month) || !isCashSide(side) || !/^[A-Z]{3}$/.test(currency)) {
    return <Navigate to={`/${search}`} replace />;
  }
  return <CashLinesBody monthKey={month} side={side} currency={currency} search={search} sample={sample} />;
}

/** The search string with ?order= set, or dropped for the default (date). */
function searchWith(search: string, order: LinesOrder): string {
  const params = new URLSearchParams(search);
  if (order === "date") params.delete("order");
  else params.set("order", order);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** The month's CashMonths entry for a month key. */
export function monthOf(data: CashMonths | undefined, key: string) {
  return data?.months.find((month) => cashMonthKey(month.month) === key);
}

const ORDER_OPTIONS = LINES_ORDERS.map((value) => ({ value, label: LINES_ORDER_LABEL[value] }));

/** V3-Lines: נכנס on the start side, יצא after it. */
const SIDE_OPTIONS: Array<{ value: "out" | "in"; label: string }> = [
  { value: "in", label: "נכנס" },
  { value: "out", label: "יצא" },
];

function CashLinesBody({
  monthKey,
  side,
  currency,
  search,
  sample,
}: {
  monthKey: string;
  side: CashListSide;
  currency: string;
  search: string;
  sample?: LinesSample;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const online = useOnline();
  const [locationParams] = useSearchParams();
  // FLOW-1111: ?project= lists one project's lines (its page's נכנס and יצא), with its month's figures, and
  // the page's own links keep it.
  const projectId = locationParams.get("project");
  const scoped = projectId == null ? search : withProjectSearch(search, projectId);
  const monthData = useCashMonthData(monthKey, sample == null && projectId == null);
  const projectMonths = useProjectCashMonthsQuery(projectId ?? "", sample == null && projectId != null);
  const projectName = useCachedProjectName(projectId);
  const months = projectId == null ? monthData.query : projectMonths;
  const lines = useCashLinesQuery(monthKey, side, currency, sample == null, projectId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = lines;
  // FLOW-366: every page loads up front; the totals and the groups need all of them.
  // A page that failed stops the loop here: a failed fetch leaves hasNextPage set, so it would retry forever.
  useEffect(() => {
    if (sample == null && hasNextPage && !isFetchingNextPage && !lines.isError) void fetchNextPage();
  }, [sample, hasNextPage, isFetchingNextPage, lines.isError, fetchNextPage]);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, lines);
  const loaded = sample?.lines ?? (lines.data?.pages ?? []).flatMap((page) => page?.rows ?? []);
  const rows = useHeldOrder(loaded, (row) => `${row.transaction_id}:${row.part ?? ""}`);
  const allLoaded = sample != null || !hasNextPage;
  const requested = linesOrder(locationParams.get("order"));
  const title = cashSideLabel(side);
  const kicker = cashTitle(monthKey);
  const data = sample?.months ?? months.data ?? null;
  const isThisMonth = monthKey === israelToday().slice(0, 7);
  // Back goes to Home on this month (Home is the month's cash page), or to the project's page.
  const back = projectId == null ? homeMonthPath(monthKey, search, israelToday().slice(0, 7)) : `/projects/${projectId}${search}`;
  // The board draws the month with its year, even in the current year ("אוקטובר 2026 • עד היום").
  const monthName = cashMonthName(monthKey);
  const monthTitle = /\d{4}$/.test(monthName) ? monthName : `${monthName} ${monthKey.slice(0, 4)}`;
  const subtitle = `${projectName == null ? "" : `${projectName} • `}${monthTitle}${isThisMonth ? " • עד היום" : ""}`;
  // FLOW-1048 (V3-Lines): the 56px bar comes down once the head has gone under it; the side and currency segments dock into it.
  const [headEnd, setHeadEnd] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(headEnd, true, DETAIL_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: DETAIL_BAR });

  if (phase.kind !== "ready") {
    // FLOW-965: a failed read hides the figures and says what happened, with נסו שוב and צריך עזרה?.
    return (
      <ScreenState
        stacked
        title={title}
        backTo={back}
        kicker={isThisMonth ? "בית" : kicker}
        stateSubtitle={monthTitle}
        headerClassName="ui-state-header"
        phase={phase}
        onRetry={() => { void lines.refetch(); }}
        loading={<LinesSkeleton />}
        failed={(retry, offline) => (
          <div className="ui-lines-state">
            <PageLoadFailed title={`${title} של ${monthName} לא נטען`} offline={offline} onRetry={retry} />
          </div>
        )}
      />
    );
  }

  const month = data == null ? undefined : monthOf(data, monthKey);
  const shown = data == null ? [] : shownCashRows(month, data.base_currency);
  const { figure, rest } = cashLinesFigures(shown, side, currency);
  const summary = linesSummary(rows, side);
  // The total is the figure Home shows for the side (the server's month row); on a side that is not
  // נכנס or יצא it is the month's figure, and on נכנס and יצא the rows once every page is in.
  const total = side === "kept" ? figure : allLoaded ? (figure ?? summary.total) : null;
  // FLOW-1048: the recurring-or-one-off order needs FLOW-1035's flag on every line; without it the page orders by date.
  const knowsRecurring = linesKnowRecurring(rows);
  const order: LinesOrder = requested === "recurring" && !knowsRecurring ? "date" : requested;
  const groups = groupLines(rows, order, side, sample?.today ?? israelToday());
  const shownIds = groups.flatMap((group) => group.rows.map((row) => row.transaction_id));
  const from = cashLinesPath(monthKey, side, currency, searchWith(scoped, order));
  const sideSwitch = (
    <SegmentedControl<"out" | "in">
      label="כיוון"
      showLabel={false}
      role="tab"
      value={side === "in" ? "in" : "out"}
      options={SIDE_OPTIONS}
      onChange={(next) => {
        scrollUnderBar();
        void navigate(cashLinesPath(monthKey, next, currency, searchWith(scoped, order)), { replace: true });
      }}
    />
  );
  const chips = (
    <OrderChips
      className="ui-lines-chips"
      value={order}
      options={knowsRecurring ? ORDER_OPTIONS : ORDER_OPTIONS.filter((option) => option.value !== "recurring")}
      onChange={(value) => {
        void navigate(cashLinesPath(monthKey, side, currency, searchWith(scoped, value)), { replace: true });
      }}
    />
  );
  const currencies = (
    <CashCurrencySwitch
      currencies={shown.map((row) => row.currency)}
      currency={currency}
      onChange={(next) => {
        scrollUnderBar();
        void navigate(cashLinesPath(monthKey, side, next, scoped), { replace: true });
      }}
    />
  );
  // The segments the bar holds once they reach it: the side, and the currency on a month with two.
  const segments = side === "kept" ? currencies : <>{sideSwitch}{currencies}</>;
  const figureText = total == null ? undefined : formatAmountText(total < 0n ? -total : total, currency);
  const headBlock = side === "kept" ? (
    <CashLinesHead side={side} currency={currency} figure={figure} rest={rest} />
  ) : (
    <>
      <LinesTotal side={side} currency={currency} total={total} />
      {/* FLOW-965: the lines waiting for approval are the page's one filled button (Home v2's). */}
      {allLoaded && summary.pending > 0 ? (
        <ReviewButton row={{ id: "review", to: `/review${search}`, title: reviewItems(summary.pending), button: { label: reviewItems(summary.pending), hint: reviewMinutes(summary.pending) } }} />
      ) : null}
    </>
  );
  // FLOW-965: offline, the page keeps the lines it read and says from when.
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online ? (lines.dataUpdatedAt || null) : null;
  const backText = projectId != null ? projectName ?? "פרויקט" : isThisMonth ? "בית" : kicker;
  return (
    <div className="ui-lines">
      <CompactBar
        title={`${title} · ${monthName}`}
        figure={figureText}
        label={backText}
        backTo={back}
        size="detail"
        shown={barShown}
        dock={segments}
        docked={docked}
      />
      <header className="ui-lines-head">
        <BackButton fallback={back} text={backText} />
        <FocusTitle className="t-title">{title}</FocusTitle>
        <p className="ui-lines-sub t-meta">{side === "kept" || !allLoaded ? subtitle : [subtitle, ...linesCountParts(summary, currency)].join(" • ")}</p>
        {headBlock}
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        <span ref={setHeadEnd} className="ui-compact-mark" aria-hidden="true" />
      </header>
      <div className="ui-lines-filter">
        <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
        <DockSlot docked={docked}>{segments}</DockSlot>
        {chips}
      </div>
      {/* The נכנס / יצא tabs' panel: what the list below shows. */}
      <div className="ui-lines-body" role={side === "kept" ? undefined : "tabpanel"} aria-label={side === "kept" ? undefined : side === "in" ? "נכנס" : "יצא"}>
      {rows.length === 0 && allLoaded ? (
        <CashLinesEmpty
          side={side}
          rest={rest}
          month={monthName}
          current={isThisMonth}
          onOther={() => {
            void navigate(cashLinesPath(monthKey, side === "in" ? "out" : "in", currency, searchWith(scoped, order)), { replace: true });
          }}
        />
      ) : (
        groups.map((group, index) => (
          <section key={group.key} className="ui-month ui-lines-group" aria-label={group.title}>
            <GroupHead
              id={`lines-group-${String(index)}`}
              title={group.title}
              summary={group.total != null ? <LinesGroupSum total={group.total} side={side} currency={currency} /> : `${String(group.rows.length)} תנועות`}
            />
            <List layout="flat">
              {group.rows.map((row) => {
                // FLOW-432: a split line names the parts this list counts, out of the whole line.
                const split = cashLineSplit(row);
                const name = row.supplier_name ?? row.description;
                // One project's lines need not name it on every row.
                const hint = [projectId == null ? row.project_name ?? "בלי פרויקט" : null, row.category_name].filter((part): part is string => part != null && part !== "").join(" · ");
                return (
                  <ListRow
                    key={`${row.transaction_id}:${row.part ?? ""}`}
                    layout="flat"
                    variant="transaction"
                    title={name}
                    hint={split == null ? hint : <SplitPartsHint parts={split.parts} total={split.total} date={formatDayMonth(row.cash_month_date)} />}
                    wrapHint={split != null}
                    agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
                    wholeCents
                    currency={row.currency}
                    sign={lineSign(side, row)}
                    inWord={side === "out" ? "זיכוי" : undefined}
                    source={rowSource(row.source)}
                    initials={lineInitials(name)}
                    tagLine={lineTagText({ pending: row.pending === true, inPnl: row.in_pnl !== false, reason: lineTagReason(row) })}
                    href={`/transactions/${row.transaction_id}${search}`}
                    state={txnListState(shownIds, row.transaction_id, from, allLoaded ? rows.length : undefined)}
                  />
                );
              })}
            </List>
          </section>
        ))
      )}
      </div>
    </div>
  );
}


/** A group's sum, with the plus on money in (decision 0181); a negative sum keeps its minus. */
function LinesGroupSum({ total, side, currency }: { total: bigint; side: CashListSide; currency: string }) {
  const sign = total < 0n ? "−" : side === "in" && total > 0n ? "+" : "";
  return <bdi className="t-line2 ui-lines-group-sum" dir="ltr">{`${sign}${formatAmountText(total < 0n ? -total : total, currency, { detail: true })}`}</bdi>;
}
