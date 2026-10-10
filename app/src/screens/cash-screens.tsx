import type { CashLine, CashMonths, CashSide } from "@flow/shared";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
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
} from "../cash";
import { useHeldOrder } from "../list-hold";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCashLinesQuery, useCashMonthData, useOpenCashRow } from "../use-cash";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { CashRows } from "../ui/cash-rows";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { DocumentIcon } from "../ui/icons";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";

/**
 * FLOW-413, frame b. An earlier month's cash page (its figure, נכנס, יצא and רווח החודש, as Home
 * shows the current month), and the lines behind one month's נכנס or יצא. Decision 0168.
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
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker="תזרים" />
      <p className="ui-breakdown-total ui-page-pad">
        {rows.map((row) => (
          <span key={row.currency} className="ui-breakdown-total-line">
            <BigNumber agorot={row.net_minor} currency={row.currency} size="display" loss={row.net_minor < 0n} />
          </span>
        ))}
      </p>
      <CashRows rows={cashSummaryRows(monthKey, rows, search)} onOpen={open} />
    </div>
  );
}

type LinesSample = { months: NonNullable<CashMonths>; lines: CashLine[] };

export function CashLinesScreen({ sample, at }: { sample?: LinesSample; at?: { month: string; side: CashSide; currency: string } } = {}) {
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
  side: CashSide;
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
  const total = shown.find((row) => row.currency === currency);
  const figure = total == null ? null : side === "in" ? total.in_minor : total.out_minor;
  const more = sample ? false : lines.hasNextPage;
  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} kicker={kicker} />
      {figure != null ? (
        <p className="ui-breakdown-total ui-page-pad">
          <span className="ui-breakdown-total-line">
            <BigNumber agorot={figure} currency={currency} size="display" income={side === "in"} />
          </span>
        </p>
      ) : null}
      {shown.length > 1 ? (
        <div className="ui-page-pad">
          <SegmentedControl
            label="מטבע"
            showLabel={false}
            value={currency}
            options={shown.map((row) => ({ value: row.currency, label: row.currency }))}
            onChange={(next) => {
              void navigate(cashLinesPath(monthKey, side, next, search), { replace: true });
            }}
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title={side === "in" ? "לא נכנס כסף בחודש הזה" : "לא יצא כסף בחודש הזה"}
          body="תנועות שנכנסות לתזרים יופיעו כאן."
        />
      ) : (
        <List>
          {rows.map((row) => {
            // The date leads, so at 320 the name is the part that drops (as the breakdown lines do).
            const hint = [formatDayMonth(row.cash_month_date), row.project_name ?? row.category_name]
              .filter((part): part is string => part != null && part !== "")
              .join(" · ");
            return (
              <ListRow
                key={`${row.transaction_id}:${row.part ?? ""}`}
                variant="transaction"
                title={row.supplier_name ?? row.description}
                hint={hint}
                agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
                currency={row.currency}
                // Under "יצא" a payment is already named, so it carries no minus; a refund on either side reads as money the other way.
                sign={side === "in" ? (row.amount_minor < 0n ? "out" : "in") : row.amount_minor < 0n ? "in" : "cost"}
                inWord={side === "out" ? "זיכוי" : undefined}
                source={rowSource(row.source)}
                href={`/transactions/${row.transaction_id}${search}`}
              />
            );
          })}
        </List>
      )}
      {more ? (
        <div className="ui-page-pad">
          <Button
            variant="pill"
            busy={lines.isFetchingNextPage}
            onClick={() => {
              void lines.fetchNextPage();
            }}
          >
            עוד תנועות
          </Button>
        </div>
      ) : null}
    </div>
  );
}
