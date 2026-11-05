import { formatAmountText, type CashMonth, type CashMonths } from "@flow/shared";
import { useState, type ReactNode, type RefObject } from "react";
import { cashRows } from "../cash";
import { canStepYear, drawerCells, type DrawerCell } from "../home-month";
import { shiftMonthKey } from "../period";
import { useCashYearMonthsQuery } from "../use-cash";
import { israelToday, HEBREW_MONTHS } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { Sheet } from "../ui/sheet";
import { IconButton } from "../ui/icon-button";
import { OutwardChevron } from "../ui/icons";
import { cx } from "../ui/cx";

/**
 * FLOW-364: the month drawer, opened from the band's month name and the compact bar's centre. A
 * year's twelve months, each with its net; a pick goes to that month on Home (`onPick`). FLOW-1036
 * (BUILD-PLAN §5): with `next`, the month after today is a cell too: it shows `next`, that month's
 * forecast card, above the grid; the band's later arrow on the current month opens the drawer there
 * (`openOnNext`). Months beyond it stay "עוד לא".
 */
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
  next = null,
  openOnNext = false,
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
  /** Next month's forecast card (the current month only); null leaves next month off. */
  next?: ReactNode;
  /** The drawer opens on next month, its forecast showing. */
  openOnNext?: boolean;
}) {
  const today = israelToday();
  const withNext = next != null;
  const nextKey = shiftMonthKey(today.slice(0, 7), 1);
  const openYear = () => (withNext && openOnNext ? Number(nextKey.slice(0, 4)) : initialYear ?? Number(selectedKey.slice(0, 4)));
  const [year, setYear] = useState(openYear);
  const [nextShown, setNextShown] = useState(open && withNext && openOnNext);
  // Each opening starts on the month it was opened for: the selected one, or next month from the later arrow.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setYear(openYear());
      setNextShown(withNext && openOnNext);
    }
  }
  const months = useCashYearMonthsQuery(year, open && yearMonths == null);
  const netByMonth = netsOf((yearMonths ?? months.data)?.months ?? [], base);
  const cells = drawerCells(year, netByMonth, firstKey, today, selectedKey, withNext);
  const canEarlier = canStepYear(year, -1, firstKey, today, withNext);
  const canLater = canStepYear(year, 1, firstKey, today, withNext);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="בחירת חודש" returnFocusRef={returnFocusRef} panelClassName="ui-sheet-wide ui-sheet-g16 ui-sheet-pad28 ui-sheet-compact">
      <div className="ui-month-drawer">
        <div className="ui-month-drawer-years">
          {/* FLOW-958: with one year of books the arrows would only ever be off, so they are not drawn. */}
          {canEarlier || canLater ? <YearStep label="שנה קודמת" side="start" disabled={!canEarlier} onClick={() => { setYear((value) => value - 1); }} /> : null}
          <p className="ui-month-drawer-year">
            <bdi>{String(year)}</bdi>
          </p>
          {canEarlier || canLater ? <YearStep label="שנה הבאה" side="end" disabled={!canLater} onClick={() => { setYear((value) => value + 1); }} /> : null}
        </div>
        {nextShown ? <div className="ui-month-drawer-next">{next}</div> : null}
        <div className="ui-month-drawer-grid">
          {cells.map((cell) => (
            <MonthCell
              key={cell.key}
              cell={cell}
              base={base}
              nextShown={nextShown}
              onPick={(key) => {
                if (cell.state === "next") setNextShown(true);
                else onPick(key);
              }}
            />
          ))}
        </div>
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

function MonthCell({ cell, base, nextShown, onPick }: { cell: DrawerCell; base: string; nextShown: boolean; onPick: (key: string) => void }) {
  const name = HEBREW_MONTHS[cell.index] ?? "";
  const off = cell.state === "future" || cell.state === "before";
  const label =
    cell.state === "future" ? `${name}, עוד לא הגיע`
    : cell.state === "before" ? `${name}, לפני הנתונים`
    : cell.state === "next" ? `${name}, תחזית`
    : `${name}, נטו ${formatAmountText(cell.netMinor ?? 0n, base)}`;
  return (
    <button
      type="button"
      className={cx("ui-month-cell", `ui-month-cell-${cell.state}`)}
      disabled={off}
      aria-current={cell.state === "selected" ? "date" : undefined}
      aria-pressed={cell.state === "next" ? nextShown : undefined}
      aria-label={label}
      onClick={() => {
        onPick(cell.key);
      }}
    >
      <span className="ui-month-cell-name">{name}</span>
      <span className="ui-month-cell-amount">
        {cell.state === "future" ? (
          "עוד לא"
        ) : cell.state === "next" ? (
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
