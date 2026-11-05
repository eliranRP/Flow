import { formatAmountText, type CashMonth, type CashMonths } from "@flow/shared";
import { useState, type RefObject } from "react";
import { cashRows } from "../cash";
import { canStepYear, drawerCells, type DrawerCell } from "../home-month";
import { useCashYearMonthsQuery } from "../use-cash";
import { israelToday, HEBREW_MONTHS } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { IconButton } from "../ui/icon-button";
import { OutwardChevron } from "../ui/icons";
import { cx } from "../ui/cx";

/**
 * FLOW-364: the month drawer, opened from the band's month name and the compact bar's centre. A
 * year's twelve months, each with its net; a pick goes to that month on Home (`onPick`). FLOW-1036: with
 * `withNext`, the month after today is a cell too, dashed and marked צפי. FLOW-1056 (owner): it picks like any
 * month, and Home shows that month's forecast. Months beyond it stay "עוד לא". FLOW-1052 (V3-Home): the year row,
 * Home's month in a tinted figure box (`figure`), the grid, and a סגירה pill; the sheet's own head is for the
 * screen reader only, as the board draws none.
 */
/** FLOW-1052: the drawer's figure box: what Home's month comes to, its label and its line under the figure. */
export type DrawerFigure = { label: string; minor: bigint | null; sub: string };

export function MonthDrawer({
  open,
  onOpenChange,
  selectedKey,
  firstKey,
  base,
  onPick,
  returnFocusRef,
  initialYear,
  yearMonths,
  withNext = false,
  currentKey,
  figure = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The month Home shows (YYYY-MM). */
  selectedKey: string;
  /** The books' first month with data, or null. */
  firstKey: string | null;
  base: string;
  onPick: (key: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** The year to open on (defaults to the selected month's). */
  initialYear?: number;
  /** Stories and the dev route pass the year's months; the live drawer reads them. */
  yearMonths?: NonNullable<CashMonths>;
  /** Next month is a cell to pick (not in a preview, which has no forecast). */
  withNext?: boolean;
  /** Home's current month (YYYY-MM), so the drawer's next month is Home's; today's month by default. */
  currentKey?: string;
  /** Home's month in the box over the grid; null draws no box. */
  figure?: DrawerFigure | null;
}) {
  const today = currentKey ?? israelToday().slice(0, 7);
  const openYear = () => initialYear ?? Number(selectedKey.slice(0, 4));
  const [year, setYear] = useState(openYear);
  // Each opening starts on the selected month's year.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setYear(openYear());
  }
  const months = useCashYearMonthsQuery(year, open && yearMonths == null);
  const netByMonth = netsOf((yearMonths ?? months.data)?.months ?? [], base);
  const cells = drawerCells(year, netByMonth, firstKey, today, selectedKey, withNext);
  const canEarlier = canStepYear(year, -1, firstKey, today, withNext);
  const canLater = canStepYear(year, 1, firstKey, today, withNext);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="בחירת חודש" returnFocusRef={returnFocusRef} panelClassName="ui-sheet-wide ui-sheet-g16 ui-sheet-compact ui-month-drawer-panel" closeButton={false}>
      <div className="ui-month-drawer">
        <div className="ui-month-drawer-years">
          {/* FLOW-958: with one year of books the arrows would only ever be off, so they are not drawn. */}
          {canEarlier || canLater ? <YearStep label="שנה קודמת" side="start" disabled={!canEarlier} onClick={() => { setYear((value) => value - 1); }} /> : null}
          <p className="ui-month-drawer-year">
            <bdi>{String(year)}</bdi>
          </p>
          {canEarlier || canLater ? <YearStep label="שנה הבאה" side="end" disabled={!canLater} onClick={() => { setYear((value) => value + 1); }} /> : null}
        </div>
        {figure == null ? null : (
          <div className="ui-month-drawer-figure">
            <span className="ui-month-drawer-figure-label t-line2">{figure.label}</span>
            <span className="ui-month-drawer-figure-value t-card">
              {figure.minor == null ? <span aria-hidden="true">—</span> : <bdi dir="ltr">{formatAmountText(figure.minor, base)}</bdi>}
            </span>
            <span className="ui-month-drawer-figure-sub t-meta">{figure.sub}</span>
          </div>
        )}
        <div className="ui-month-drawer-grid">
          {cells.map((cell) => (
            <MonthCell key={cell.key} cell={cell} base={base} onPick={onPick} />
          ))}
        </div>
        <Button full onClick={() => { onOpenChange(false); }}>
          סגירה
        </Button>
      </div>
    </Sheet>
  );
}

function netsOf(months: readonly CashMonth[], base: string): Record<string, bigint> {
  const nets: Record<string, bigint> = {};
  for (const month of months) {
    const row = cashRows(month, base).find((figures) => figures.currency === base);
    nets[month.month.slice(0, 7)] = row?.net_minor ?? 0n;
  }
  return nets;
}

function YearStep({ label, side, disabled, onClick }: { label: string; side: "start" | "end"; disabled: boolean; onClick: () => void }) {
  return (
    <IconButton
      label={label}
      className={cx("ui-month-drawer-step", disabled && "ui-month-drawer-step-off")}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <OutwardChevron side={side} />
    </IconButton>
  );
}

function MonthCell({ cell, base, onPick }: { cell: DrawerCell; base: string; onPick: (key: string) => void }) {
  const name = HEBREW_MONTHS[cell.index] ?? "";
  const off = cell.state === "future" || cell.state === "before";
  // FLOW-1056: next month, picked or not, is a forecast: צפי, never a net.
  const forecast = cell.state === "next" || (cell.state === "selected" && cell.netMinor == null);
  const label =
    cell.state === "future" ? `${name}, עוד לא הגיע`
    : cell.state === "before" ? `${name}, לפני הנתונים`
    : forecast ? `${name}, תחזית`
    : `${name}, נטו ${formatAmountText(cell.netMinor ?? 0n, base)}`;
  return (
    <button
      type="button"
      className={cx("ui-month-cell", `ui-month-cell-${cell.state}`)}
      disabled={off}
      aria-current={cell.state === "selected" ? "date" : undefined}
      aria-label={label}
      onClick={() => {
        onPick(cell.key);
      }}
    >
      <span className="ui-month-cell-name">{name}</span>
      <span className="ui-month-cell-amount">
        {cell.state === "future" ? (
          "עוד לא"
        ) : forecast ? (
          "צפי"
        ) : cell.state === "before" ? (
          "—"
        ) : (
          <Amount agorot={cell.netMinor ?? 0n} currency={base} size="list" loss={(cell.netMinor ?? 0n) < 0n} />
        )}
      </span>
    </button>
  );
}
