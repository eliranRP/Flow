import { useEffect, useState } from "react";
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
  disabled?: boolean;
};

/** One day, shown as DD/MM/YYYY on the field that opens this sheet. */
export function DateSheet({
  open,
  onOpenChange,
  title,
  value,
  onApply,
  allowFuture = false,
  disabled = false,
}: DateSheetProps) {
  const setOpen = useSheetHistory("loan-date", open, onOpenChange);
  const today = israelToday();
  const [pending, setPending] = useState(value);
  const [cursor, setCursor] = useState(() => monthOf(value));
  const nextDisabled = !allowFuture && (
    cursor.year > Number(today.slice(0, 4)) ||
    (cursor.year === Number(today.slice(0, 4)) && cursor.month >= Number(today.slice(5, 7)) - 1)
  );

  useEffect(() => {
    if (!open) return;
    setPending(value);
    setCursor(monthOf(value));
  }, [open, value]);

  function choose(iso: string) {
    if (!allowFuture && iso > today) return;
    setPending(iso);
    setCursor(monthOf(iso));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={title}
      action={
        <Button
          full
          disabled={disabled}
          onClick={() => {
            onApply(pending);
            setOpen(false);
          }}
        >
          בחירה
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Chip
          pressed={pending === today}
          onClick={() => {
            choose(today);
          }}
        >
          היום
        </Chip>
        <Chip
          pressed={pending === shiftDays(today, -1)}
          onClick={() => {
            choose(shiftDays(today, -1));
          }}
        >
          אתמול
        </Chip>
      </div>
      <div className="ui-band-row">
        <IconButton
          label="חודש קודם"
          disabled={disabled}
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
        onPick={choose}
      />
      <p className="t-label">{dayLabel(pending)}</p>
      <p className="t-hint">
        <bdi className="ui-num" dir="ltr">{formatDisplay(pending)}</bdi>
      </p>
    </Sheet>
  );
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
