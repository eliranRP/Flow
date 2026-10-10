import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSheetHistory } from "./back";
import { Button } from "./button";
import { Chip } from "./chip";
import { dayLabel, formatDisplay, israelToday, monthTitle, shiftDays, shiftMonth } from "./date-math";
import { IconButton } from "./icon-button";
import { ChevronDownIcon, OutwardChevron } from "./icons";
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
  // FLOW-115: a tap on the month title swaps the days for the years, so an old loan start is one tap away.
  const [years, setYears] = useState(false);
  const yearsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const todayYear = Number(today.slice(0, 4));
  const lastMonth = lastPickableMonth(today, allowFuture, max);
  const firstMonth = min != null ? monthIndex(monthOf(min)) : null;
  const yearFirst = firstMonth != null ? Math.floor(firstMonth / 12) : todayYear - YEARS_BACK;
  const yearLast = lastMonth != null ? Math.floor(lastMonth / 12) : todayYear + YEARS_AHEAD;
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
    setYears(false);
  }, [open, value]);

  useEffect(() => {
    if (!years) return;
    // The picked year starts in the middle of the list; only the list scrolls, never the sheet.
    const box = yearsRef.current;
    const picked = box?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (box && picked) {
      box.scrollTop = picked.offsetTop - (box.clientHeight - picked.offsetHeight) / 2;
      picked.focus({ preventScroll: true });
    }
  }, [years]);

  function chooseYear(year: number) {
    let index = year * 12 + cursor.month;
    if (lastMonth != null) index = Math.min(index, lastMonth);
    if (firstMonth != null) index = Math.max(index, firstMonth);
    setCursor({ year: Math.floor(index / 12), month: index % 12 });
    setYears(false);
    // The picked year's button leaves with the list: focus stays in the sheet, on the title that names the new month.
    titleRef.current?.focus();
  }

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
          disabled={disabled || years || prevDisabled}
          onClick={() => {
            setCursor((current) => shiftMonth(current, -1));
          }}
        >
          <OutwardChevron side="start" />
        </IconButton>
        <button
          ref={titleRef}
          type="button"
          className="t-label ui-date-title"
          aria-expanded={years}
          aria-label={`${monthTitle(cursor.year, cursor.month)}, בחירת שנה`}
          disabled={disabled || busy || yearFirst >= yearLast}
          onClick={() => {
            setYears((current) => !current);
          }}
        >
          {monthTitle(cursor.year, cursor.month)}
          <ChevronDownIcon />
        </button>
        <IconButton
          label="חודש הבא"
          disabled={disabled || years || nextDisabled}
          onClick={() => {
            setCursor((current) => shiftMonth(current, 1));
          }}
        >
          <OutwardChevron side="end" />
        </IconButton>
      </div>
      {years ? (
        <div ref={yearsRef} className="ui-date-years" role="group" aria-label="שנה">
          {Array.from({ length: yearLast - yearFirst + 1 }, (_, offset) => yearLast - offset).map((year) => (
            <button
              key={year}
              type="button"
              className="ui-day ui-year"
              aria-pressed={year === cursor.year}
              aria-current={year === todayYear ? "date" : undefined}
              disabled={busy}
              onClick={() => {
                chooseYear(year);
              }}
            >
              <b className="ui-num">{year}</b>
            </button>
          ))}
        </div>
      ) : (
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
      )}
      <p className="t-label">{dayLabel(pending)}</p>
      <p className="t-hint">
        <bdi className="ui-num" dir="ltr">{formatDisplay(pending)}</bdi>
      </p>
      {error ? <p id={errorId} className="ui-field-message ui-date-error" role="alert">{error}</p> : null}
    </Sheet>
  );
}

/** How far the year list reaches when no `min` or `max` bounds it: old loans start decades back. */
const YEARS_BACK = 40;
const YEARS_AHEAD = 10;

/** The last month a day can be picked in, as a month index, or null when nothing bounds it. */
function lastPickableMonth(today: string, allowFuture: boolean, max: string | null): number | null {
  const bounds = [...(allowFuture ? [] : [monthIndex(monthOf(today))]), ...(max != null ? [monthIndex(monthOf(max))] : [])];
  return bounds.length > 0 ? Math.min(...bounds) : null;
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
