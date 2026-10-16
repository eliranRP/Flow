import { type CashLine, type CashMonths, formatAmountText } from "@flow/shared";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  type CashListSide,
  cashLineSplit,
  cashLinesPath,
  cashMonthKey,
  cashMonthName,
  cashMonthPath,
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
  lineTagReason,
  linesOrder,
  linesSummary,
  type LinesOrder,
} from "../cash-lines-groups";
import { useHeldOrder } from "../list-hold";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useCashLinesQuery, useCashMonthData } from "../use-cash";
import { Chip } from "../ui/chip";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { lineTagText, rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { OrganizeChips } from "../ui/organize-chips";
import { ScreenHeader } from "../ui/screen-header";
import { LinesSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { SplitPartsHint } from "../ui/split-parts-hint";
import { txnListState } from "../txn-nav";
import { CashCurrencySwitch, CashLinesEmpty, CashLinesHead, LinesCount, LinesTotal, cashLinesFigures } from "./cash-lines-parts";

/**
 * FLOW-366. The lines behind one month's נכנס or יצא (or FLOW-418 the cash profit leaves out), in
 * the order ?order= picks: a segment to flip the side, the total and the count line, the order
 * chips, groups with sticky heads, and every page loaded up front.
 */

function lineSign(side: CashListSide, row: CashLine): "in" | "out" | "cost" {
  const back = row.amount_minor < 0n;
  if (side === "in") return back ? "out" : "in";
  if (side === "out") return back ? "in" : "cost";
  return (row.side === "in") !== back ? "in" : "out";
}

type LinesSample = { months: NonNullable<CashMonths>; lines: CashLine[] };

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
function monthOf(data: CashMonths | undefined, key: string) {
  return data?.months.find((month) => cashMonthKey(month.month) === key);
}

const SIDE_OPTIONS: Array<{ value: "out" | "in"; label: string }> = [
  { value: "out", label: "יצא" },
  { value: "in", label: "נכנס" },
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
  const monthData = useCashMonthData(monthKey, sample == null);
  const months = monthData.query;
  const lines = useCashLinesQuery(monthKey, side, currency, sample == null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = lines;
  // FLOW-366: every page loads up front; the totals and the groups need all of them.
  useEffect(() => {
    if (sample == null && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [sample, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, lines);
  const loaded = sample?.lines ?? (lines.data?.pages ?? []).flatMap((page) => page?.rows ?? []);
  const rows = useHeldOrder(loaded, (row) => `${row.transaction_id}:${row.part ?? ""}`);
  const allLoaded = sample != null || !hasNextPage;
  const [locationParams] = useSearchParams();
  const order = linesOrder(locationParams.get("order"));
  const title = cashSideLabel(side);
  const kicker = cashTitle(monthKey);
  const data = sample?.months ?? months.data ?? null;
  const isCurrent = (sample != null || monthData.recent) && data != null && data.months[0] != null && cashMonthKey(data.months[0].month) === monthKey;
  const back = isCurrent ? `/${search}` : cashMonthPath(monthKey, search);
  const isThisMonth = monthKey === israelToday().slice(0, 7);
  const subtitle = `${cashMonthName(monthKey)}${isThisMonth ? " · עד היום" : ""}`;

  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker={kicker} phase={phase} onRetry={() => { void lines.refetch(); }} loading={<LinesSkeleton />} />;
  }

  const month = data == null ? undefined : monthOf(data, monthKey);
  const shown = data == null ? [] : shownCashRows(month, data.base_currency);
  const { figure, rest } = cashLinesFigures(shown, side, currency);
  const summary = linesSummary(rows, side);
  // The total is the figure Home shows for the side (the server's month row); on a side that is not
  // נכנס or יצא it is the month's figure, and on נכנס and יצא the rows once every page is in.
  const total = side === "kept" ? figure : allLoaded ? (figure ?? summary.total) : null;
  const groups = groupLines(rows, order, side, israelToday());
  const shownIds = groups.flatMap((group) => group.rows.map((row) => row.transaction_id));
  const from = cashLinesPath(monthKey, side, currency, searchWith(search, order));
  const sideSwitch = (
    <SegmentedControl<"out" | "in">
      label="כיוון"
      showLabel={false}
      value={side === "in" ? "in" : "out"}
      options={SIDE_OPTIONS}
      onChange={(next) => {
        void navigate(cashLinesPath(monthKey, next, currency, searchWith(search, order)), { replace: true });
      }}
    />
  );
  const chips = (
    <OrganizeChips className="ui-lines-chips" label="סדר">
      {LINES_ORDERS.map((value) => (
        <Chip
          key={value}
          pressed={order === value}
          onClick={() => {
            void navigate(cashLinesPath(monthKey, side, currency, searchWith(search, value)), { replace: true });
          }}
        >
          {LINES_ORDER_LABEL[value]}
        </Chip>
      ))}
    </OrganizeChips>
  );
  const currencies = (
    <CashCurrencySwitch
      currencies={shown.map((row) => row.currency)}
      currency={currency}
      onChange={(next) => {
        void navigate(cashLinesPath(monthKey, side, next, search), { replace: true });
      }}
    />
  );
  const figureText = total == null ? undefined : formatAmountText(total < 0n ? -total : total, currency);
  const headBlock = side === "kept" ? (
    <CashLinesHead side={side} currency={currency} figure={figure} rest={rest} />
  ) : (
    <>
      <LinesTotal side={side} currency={currency} total={total} />
      {allLoaded ? <LinesCount summary={summary} currency={currency} /> : null}
    </>
  );
  return (
    <div>
      <ScreenHeader
        layout="stacked"
        title={title}
        backTo={back}
        kicker={kicker}
        subtitle={subtitle}
        compactFigure={figureText}
        panel={side === "kept" ? chips : <>{sideSwitch}{chips}</>}
        below={
          <>
            {side === "kept" ? null : <div className="ui-page-pad">{sideSwitch}</div>}
            {headBlock}
            {currencies}
            {chips}
          </>
        }
      />
      {rows.length === 0 && allLoaded ? (
        <CashLinesEmpty side={side} rest={rest} />
      ) : (
        groups.map((group) => (
          <section key={group.key} className="ui-lines-group" aria-label={group.title}>
            <div className="ui-lines-group-head">
              <h2 className="t-section ui-lines-group-title">{group.title}</h2>
              {group.total != null ? <LinesGroupSum total={group.total} side={side} currency={currency} /> : null}
            </div>
            <List layout="flat">
              {group.rows.map((row) => {
                // FLOW-432: a split line names the parts this list counts, out of the whole line.
                const split = cashLineSplit(row);
                const name = row.supplier_name ?? row.description;
                const hint = [row.project_name ?? "בלי פרויקט", row.category_name].filter((part): part is string => part != null && part !== "").join(" · ");
                return (
                  <ListRow
                    key={`${row.transaction_id}:${row.part ?? ""}`}
                    layout="flat"
                    variant="transaction"
                    title={name}
                    hint={split == null ? hint : <SplitPartsHint parts={split.parts} total={split.total} date={formatDayMonth(row.cash_month_date)} />}
                    wrapHint={split != null}
                    agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
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
  );
}

/** A group's sum, with the plus on money in (decision 0181); a negative sum keeps its minus. */
function LinesGroupSum({ total, side, currency }: { total: bigint; side: CashListSide; currency: string }) {
  const sign = total < 0n ? "−" : side === "in" && total > 0n ? "+" : "";
  return <bdi className="t-line2 ui-lines-group-sum" dir="ltr">{`${sign}${formatAmountText(total < 0n ? -total : total, currency)}`}</bdi>;
}
