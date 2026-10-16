import { type CashLine, type CashMonths } from "@flow/shared";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  type CashListSide,
  cashLineSplit,
  cashMonthKey,
  cashLinesPath,
  cashMonthPath,
  cashSideLabel,
  cashTitle,
  isCashMonthKey,
  isCashSide,
  shownCashRows,
} from "../cash";
import { useHeldOrder } from "../list-hold";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useCashLinesQuery, useCashMonthData } from "../use-cash";
import { formatDayMonth } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { SplitPartsHint } from "../ui/split-parts-hint";
import { ScreenHeader } from "../ui/screen-header";
import { LinesSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { CashCurrencySwitch, CashLinesEmpty, CashLinesHead, CashLinesMore, cashLinesFigures } from "./cash-lines-parts";

/** The month's CashMonths entry for a month key. */
function monthOf(data: CashMonths | undefined, key: string) {
  return data?.months.find((month) => cashMonthKey(month.month) === key);
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
    return <ScreenState stacked title={title} backTo={back} kicker={kicker} phase={phase} onRetry={() => { void lines.refetch(); }} loading={<LinesSkeleton />} />;
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
