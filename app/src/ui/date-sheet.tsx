import { useEffect, useId, useState, type ReactNode } from "react";
import { useSheetHistory } from "./back";
import { Button } from "./button";
import { Chip } from "./chip";
import { dayLabel, formatDisplay, israelToday, monthTitle, shiftDays, shiftMonth } from "./date-math";
import { IconButton } from "./icon-button";
import { MonthGrid } from "./month-grid";
import { Sheet } from "./sheet";

type DateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: string;
  onApply: (iso: string) => void;
  /** Loan starts are often next month. The range sheet keeps future days off. */
  allowFuture?: boolean;
  /**
   * היום / אתמול. On by default so a normal date sheet keeps them.
   * The loan start turns them off: the 1st of next month is already the shortcut.
   */
  shortcuts?: boolean;
  disabled?: boolean;
  /** The first day that can be picked. Earlier days are disabled, and `reason` says why. */
  min?: string | null;
  /** The last day that can be picked, on top of the future rule. */
  max?: string | null;
  /** One quiet line under the title that explains `min` (FLOW-106: the last attached payment). */
  reason?: ReactNode;
  /** The button's word. Default בחירה; a loan's close date says החלה. */
  applyLabel?: string;
  /**
   * A sheet that saves keeps itself open: `onApply` returns false (or a promise of false) when
   * the save was refused, and `error` says why under the date. Default: close on apply.
   */
  onApplyResult?: (iso: string) => boolean | Promise<boolean>;
  /** The save is running: the button spins and the days stay still. */
  busy?: boolean;
  /** A refusal for the picked day, shown under it in the error colour. */
  error?: string | null;
};

/** One day, shown as DD/MM/YYYY on the field that opens this sheet. */
export function DateSheet({
  open,
  onOpenChange,
  title,
  value,
  onApply,
  allowFuture = false,
  shortcuts = true,
  disabled = false,
  min = null,
  max = null,
  reason,
  applyLabel = "בחירה",
  onApplyResult,
  busy = false,
  error = null,
}: DateSheetProps) {
  const setOpen = useSheetHistory("loan-date", open, (next) => {
    if (!next && busy) return;
    onOpenChange(next);
  });
  const today = israelToday();
  const errorId = useId();
  const [pending, setPending] = useState(value);
  const [cursor, setCursor] = useState(() => monthOf(value));
  const nextDisabled = (!allowFuture && (
    cursor.year > Number(today.slice(0, 4)) ||
    (cursor.year === Number(today.slice(0, 4)) && cursor.month >= Number(today.slice(5, 7)) - 1)
  )) || (max != null && monthIndex(cursor) >= monthIndex(monthOf(max)));
  const prevDisabled = min != null && monthIndex(cursor) <= monthIndex(monthOf(min));
  const outside = (iso: string) => (!allowFuture && iso > today) || (min != null && iso < min) || (max != null && iso > max);

  useEffect(() => {
    if (!open) return;
    setPending(value);
    setCursor(monthOf(value));
  }, [open, value]);

  function choose(iso: string) {
    if (busy || outside(iso)) return;
    setPending(iso);
    setCursor(monthOf(iso));
  }

  async function apply() {
    if (busy || outside(pending)) return;
    if (onApplyResult) {
      const closed = await onApplyResult(pending);
      if (closed) setOpen(false);
      return;
    }
    onApply(pending);
    setOpen(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={title}
      action={
        <Button
          full
          disabled={disabled || outside(pending)}
          busy={busy}
          aria-describedby={error ? errorId : undefined}
          onClick={() => {
            void apply();
          }}
        >
          {applyLabel}
        </Button>
      }
    >
      {reason != null ? <p className="t-hint ui-date-reason">{reason}</p> : null}
      {shortcuts ? (
        <div className="flex flex-wrap gap-2">
          <Chip
            pressed={pending === today}
            kind={outside(today) ? "disabled" : "choice"}
            onClick={() => {
              choose(today);
            }}
          >
            היום
          </Chip>
          <Chip
            pressed={pending === shiftDays(today, -1)}
            kind={outside(shiftDays(today, -1)) ? "disabled" : "choice"}
            onClick={() => {
              choose(shiftDays(today, -1));
            }}
          >
            אתמול
          </Chip>
        </div>
      ) : null}
      <div className="ui-band-row">
        <IconButton
          label="חודש קודם"
          disabled={disabled || prevDisabled}
          onClick={() => {
            setCursor((current) => shiftMonth(current, -1));
          }}
        >
          ›
        </IconButton>
        <p className="t-label">{monthTitle(cursor.year, cursor.month)}</p>
        <IconButton
          label="חודש הבא"
          disabled={disabled || nextDisabled}
          onClick={() => {
            setCursor((current) => shiftMonth(current, 1));
          }}
        >
          ‹
        </IconButton>
      </div>
      <MonthGrid
        label={title}
        year={cursor.year}
        month={cursor.month}
        today={today}
        value={pending}
        allowFuture={allowFuture}
        min={min}
        max={max}
        onPick={choose}
      />
      <p className="t-label">{dayLabel(pending)}</p>
      <p className="t-hint">
        <bdi className="ui-num" dir="ltr">{formatDisplay(pending)}</bdi>
      </p>
      {error ? <p id={errorId} className="ui-field-message ui-date-error" role="alert">{error}</p> : null}
    </Sheet>
  );
}

function monthIndex(cursor: { year: number; month: number }): number {
  return cursor.year * 12 + cursor.month;
}

function monthOf(iso: string): { year: number; month: number } {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const today = israelToday();
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
  }
  return { year, month: month - 1 };
}
