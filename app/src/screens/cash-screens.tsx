import { type CashLine, type CashMonths } from "@flow/shared";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  type CashListSide,
  cashMonthKey,
  cashLinesPath,
  cashMonthPath,
  cashSideLabel,
  cashSummaryRows,
  cashTitle,
  cashYearPath,
  isCashMonthKey,
  isCashSide,
  shownCashRows,
  cashLineSplit,
} from "../cash";
import { useHeldOrder } from "../list-hold";
import { anchorOf, monthPeriod, shiftMonthKey, type PeriodChoice } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCashLinesQuery, useCashMonthData, useCashYearsQuery, useOpenCashRow } from "../use-cash";
import { Amount } from "../ui/amount";
import { CashRows } from "../ui/cash-rows";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { SplitPartsHint } from "../ui/split-parts-hint";
import { MonthStepper } from "../ui/month-stepper";
import { PeriodSwipe } from "../ui/period-swipe";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { CashCurrencySwitch, CashLinesEmpty, CashLinesHead, CashLinesMore, cashLinesFigures } from "./cash-lines-parts";

/**
 * FLOW-413, frame b. An earlier month's cash page (its figure, נכנס, יצא and "רווח ב<month>", as Home
 * shows the current month), and the lines behind one month's נכנס or יצא, or (FLOW-418) the cash
 * profit leaves out. Decision 0168.
 */

function monthOf(data: CashMonths | undefined, key: string) {
  return data?.months.find((month) => cashMonthKey(month.month) === key);
}

/** Dev fixtures pass the month and the sample; the app reads the month from the path. */
export function CashMonthScreen({ sample, monthKey }: { sample?: NonNullable<CashMonths>; monthKey?: string } = {}) {
  const params = useParams();
  const month = monthKey ?? params.month;
  const search = usePreviewSearch();
  if (!isCashMonthKey(month)) return <Navigate to={`/${search}`} replace />;
  return <CashMonthBody monthKey={month} search={search} sample={sample} />;
}

function CashMonthBody({ monthKey, search, sample }: { monthKey: string; search: string; sample?: NonNullable<CashMonths> }) {
  const preview = useHomePreview();
  const open = useOpenCashRow();
  // FLOW-417: a month older than Home's reads its year, and Back returns to that year.
  const { query, recent } = useCashMonthData(monthKey, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const title = cashTitle(monthKey);
  const back = recent ? `/${search}` : cashYearPath(Number(monthKey.slice(0, 4)), search);
  const navigate = useNavigate();
  // FLOW-362 (C15-6): the page steps months, from the books' first month to this one.
  const years = useCashYearsQuery(sample == null);
  const first = sample ? cashMonthKey(sample.months.at(-1)?.month ?? monthKey) : years.data?.first_month ? cashMonthKey(years.data.first_month) : null;
  const opens = (key: string) => first != null && key >= first && key <= israelToday().slice(0, 7);
  const go = (key: string) => {
    void navigate(cashMonthPath(key, search), { replace: true });
  };
  const earlierKey = shiftMonthKey(monthKey, -1);
  const laterKey = shiftMonthKey(monthKey, 1);
  const stepper = (
    <MonthStepper
      earlier={opens(earlierKey) ? cashTitle(earlierKey) : null}
      later={opens(laterKey) ? cashTitle(laterKey) : null}
      onStep={(delta) => {
        go(delta < 0 ? earlierKey : laterKey);
      }}
    />
  );
  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker="תזרים" phase={phase} onRetry={() => { void query.refetch(); }} />;
  }
  const data = sample ?? query.data ?? null;
  const month = monthOf(data ?? undefined, monthKey);
  // A month outside the books (after this one) has no page.
  if (data == null || month == null) return <Navigate to={back} replace />;
  const rows = shownCashRows(month, data.base_currency);
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker="תזרים" titleAside={stepper} />
      {/* A sideways swipe on the figure steps the month, as on the profit band (FLOW-336). */}
      <PeriodSwipe
        period={monthPeriod(monthKey)}
        allow={(next: PeriodChoice) => opens(anchorOf(next))}
        onChange={(next) => {
          go(anchorOf(next));
        }}
      >
        <p className="ui-breakdown-total ui-page-pad">
          {rows.map((row) => (
            <span key={row.currency} className="ui-breakdown-total-line">
              <Amount agorot={row.net_minor} currency={row.currency} size="display" loss={row.net_minor < 0n} />
            </span>
          ))}
        </p>
      </PeriodSwipe>
      <CashRows rows={cashSummaryRows(monthKey, rows, search)} onOpen={open} />
    </div>
  );
}

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
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, lines);
  const loaded = sample?.lines ?? (lines.data?.pages ?? []).flatMap((page) => page?.rows ?? []);
  const rows = useHeldOrder(loaded, (row) => `${row.transaction_id}:${row.part ?? ""}`);
  const title = cashSideLabel(side);
  const kicker = cashTitle(monthKey);
  const data = sample?.months ?? months.data ?? null;
  const isCurrent = (sample != null || monthData.recent) && data != null && data.months[0] != null && cashMonthKey(data.months[0].month) === monthKey;
  const back = isCurrent ? `/${search}` : cashMonthPath(monthKey, search);

  if (phase.kind !== "ready") {
    return <ScreenState stacked title={title} backTo={back} kicker={kicker} phase={phase} onRetry={() => { void lines.refetch(); }} />;
  }

  const month = data == null ? undefined : monthOf(data, monthKey);
  const shown = data == null ? [] : shownCashRows(month, data.base_currency);
  const { figure, rest } = cashLinesFigures(shown, side, currency);
  const more = sample ? false : lines.hasNextPage;
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker={kicker} />
      <CashLinesHead side={side} currency={currency} figure={figure} rest={rest} />
      <CashCurrencySwitch
        currencies={shown.map((row) => row.currency)}
        currency={currency}
        onChange={(next) => {
          void navigate(cashLinesPath(monthKey, side, next, search), { replace: true });
        }}
      />
      {rows.length === 0 ? (
        <CashLinesEmpty side={side} rest={rest} />
      ) : (
        <List>
          {rows.map((row) => {
            // The date leads, so at 320 the name is the part that drops (as the breakdown lines do).
            const hint = [formatDayMonth(row.cash_month_date), row.project_name ?? row.category_name]
              .filter((part): part is string => part != null && part !== "")
              .join(" · ");
            // FLOW-432: a split line names the parts this list counts, out of the whole line.
            const split = cashLineSplit(row);
            return (
              <ListRow
                key={`${row.transaction_id}:${row.part ?? ""}`}
                variant="transaction"
                title={row.supplier_name ?? row.description}
                hint={split == null ? hint : <SplitPartsHint parts={split.parts} total={split.total} date={formatDayMonth(row.cash_month_date)} />}
                wrapHint={split != null}
                agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
                currency={row.currency}
                // Under "יצא" a payment is already named, so it carries no minus; a refund on either side reads as money the other way.
                // Under "לא נספר ברווח" both sides mix, so money out keeps its minus.
                sign={lineSign(side, row)}
                inWord={side === "out" ? "זיכוי" : undefined}
                source={rowSource(row.source)}
                href={`/transactions/${row.transaction_id}${search}`}
              />
            );
          })}
        </List>
      )}
      {more ? (
        <CashLinesMore
          busy={lines.isFetchingNextPage}
          onMore={() => {
            void lines.fetchNextPage();
          }}
        />
      ) : null}
    </div>
  );
}
