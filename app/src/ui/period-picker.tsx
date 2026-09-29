import { useMemo, useRef, useState } from "react";
import { useSheetHistory } from "./back";
import { Button } from "./button";
import { Chip } from "./chip";
import {
  formatDisplay,
  inclusiveDays,
  israelToday,
  monthSpan,
  monthTitle,
  previousMonthSpan,
  rangeLengthLabel,
  shiftMonth,
  yearSpan,
} from "./date-math";
import { CalendarIcon, ChevronDownIcon, ChevronIcon } from "./icons";
import { IconButton } from "./icon-button";
import { MonthGrid } from "./month-grid";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";

export type PeriodOption = {
  label: string;
  hint?: string;
  selected?: boolean;
  onSelect: () => void;
};

type PeriodPickerProps = {
  pill: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: PeriodOption[];
  onCustom?: () => void;
};

export function PeriodPicker({ pill, open, onOpenChange, options, onCustom }: PeriodPickerProps) {
  const custom = useRef(false);
  const setOpen = useSheetHistory("period", open, onOpenChange);
  return (
    <>
      <button
        type="button"
        className="ui-band-period ui-hit"
        aria-label={pill}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="ui-period-label">{pill}</span>
        <span className="ui-period-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="תקופה"
        onClosed={() => {
          if (!custom.current) return;
          custom.current = false;
          onCustom?.();
        }}
      >
        <div role="radiogroup" aria-label="תקופה">
          {options.map((option) => (
            <RadioRow
              key={option.label}
              label={option.label}
              hint={option.hint}
              selected={option.selected ?? option.label === pill}
              onSelect={() => {
                option.onSelect();
                setOpen(false);
              }}
            />
          ))}
        </div>
        {onCustom ? (
          <button
            type="button"
            className="ui-radio-row"
            onClick={() => {
              custom.current = true;
              setOpen(false);
            }}
          >
            <CalendarIcon size={20} />
            <span className="ui-row-text">
              <span className="ui-row-title">טווח מותאם</span>
              <span className="ui-row-hint">בחירת תאריכים בלוח</span>
            </span>
            <span className="ui-banner-chevron">
              <ChevronIcon />
            </span>
          </button>
        ) : null}
      </Sheet>
    </>
  );
}

type RangeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (from: string, to: string) => void;
};

/** Opens only after the period sheet has closed, so the two sheets never stack. */
export function RangeSheet({ open, onOpenChange, onApply }: RangeSheetProps) {
  const setOpen = useSheetHistory("period-range", open, onOpenChange);
  const today = israelToday();
  const spans = useMemo(
    () => ({ month: monthSpan(), previous: previousMonthSpan(), year: yearSpan() }),
    [],
  );
  const [from, setFrom] = useState(spans.month.from);
  const [to, setTo] = useState(today);
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [arm, setArm] = useState<"from" | "to">("from");
  const nextDisabled =
    cursor.year > Number(today.slice(0, 4)) ||
    (cursor.year === Number(today.slice(0, 4)) && cursor.month >= Number(today.slice(5, 7)) - 1);

  function pick(iso: string) {
    if (iso > today) return;
    if (arm === "from") {
      setFrom(iso);
      if (iso > to) setTo(iso);
      setArm("to");
      return;
    }
    if (iso < from) {
      setTo(from);
      setFrom(iso);
    } else {
      setTo(iso);
    }
    setArm("from");
  }

  function preset(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    setCursor({ year: Number(nextTo.slice(0, 4)), month: Number(nextTo.slice(5, 7)) - 1 });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="טווח מותאם"
      action={
        <Button
          full
          onClick={() => {
            onApply(from, to);
            setOpen(false);
          }}
        >
          {rangeLengthLabel(inclusiveDays(from, to))}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Chip
          pressed={from === spans.month.from && to === spans.month.to}
          onClick={() => {
            preset(spans.month.from, spans.month.to);
          }}
        >
          החודש
        </Chip>
        <Chip
          pressed={from === spans.previous.from && to === spans.previous.to}
          onClick={() => {
            preset(spans.previous.from, spans.previous.to);
          }}
        >
          חודש קודם
        </Chip>
        <Chip
          pressed={from === spans.year.from && to === today}
          onClick={() => {
            preset(spans.year.from, today);
          }}
        >
          מתחילת השנה
        </Chip>
      </div>
      <p className="t-hint">
        מתאריך <bdi dir="ltr">{formatDisplay(from)}</bdi>
      </p>
      <p className="t-hint">
        עד תאריך <bdi dir="ltr">{formatDisplay(to)}</bdi>
      </p>
      <div className="ui-band-row">
        <IconButton
          label="חודש קודם"
          onClick={() => {
            setCursor((current) => shiftMonth(current, -1));
          }}
        >
          ›
        </IconButton>
        <p className="t-label">{monthTitle(cursor.year, cursor.month)}</p>
        <IconButton
          label="חודש הבא"
          disabled={nextDisabled}
          onClick={() => {
            setCursor((current) => shiftMonth(current, 1));
          }}
        >
          ‹
        </IconButton>
      </div>
      <MonthGrid label="טווח מותאם" year={cursor.year} month={cursor.month} today={today} range={{ from, to }} onPick={pick} />
    </Sheet>
  );
}
