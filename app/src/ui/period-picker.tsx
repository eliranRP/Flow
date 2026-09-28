import { useRef, useState } from "react";
import { Button } from "./button";
import { Chip } from "./chip";
import { dayLabel, formatDisplay, israelToday, monthCells, monthTitle } from "./date-math";
import { CalendarIcon, ChevronIcon } from "./icons";
import { IconButton } from "./icon-button";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";
import { lastMonth, thisMonth, yearToDate } from "../period";

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
  return (
    <>
      <button
        type="button"
        className="band-period ui-hit"
        onClick={() => {
          onOpenChange(true);
        }}
      >
        {pill}
        <span aria-hidden="true"> ▾</span>
      </button>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
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
                onOpenChange(false);
              }}
            />
          ))}
          {onCustom ? (
            <button
              type="button"
              className="ui-radio-row"
              onClick={() => {
                custom.current = true;
                onOpenChange(false);
              }}
            >
              <CalendarIcon size={20} />
              <span className="ui-row-title">טווח מותאם</span>
              <span className="ui-banner-chevron">
                <ChevronIcon />
              </span>
            </button>
          ) : null}
        </div>
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
  const today = israelToday();
  const start = thisMonth().from ?? today;
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [arm, setArm] = useState<"from" | "to">("from");
  const cells = monthCells(cursor.year, cursor.month);
  const monthKey = String(cursor.month + 1).padStart(2, "0");
  const nextDisabled =
    cursor.year > Number(today.slice(0, 4)) ||
    (cursor.year === Number(today.slice(0, 4)) && cursor.month >= Number(today.slice(5, 7)) - 1);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

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
    <Sheet open={open} onOpenChange={onOpenChange} title="טווח מותאם">
      <div className="flex flex-wrap gap-2">
        <Chip
          pressed={from === start && to === today}
          onClick={() => {
            preset(start, today);
          }}
        >
          החודש
        </Chip>
        <Chip
          pressed={from === (lastMonth().from ?? from) && to === (lastMonth().to ?? to)}
          onClick={() => {
            const previous = lastMonth();
            if (previous.from && previous.to) preset(previous.from, previous.to);
          }}
        >
          חודש קודם
        </Chip>
        <Chip
          pressed={from === (yearToDate().from ?? from) && to === today}
          onClick={() => {
            const year = yearToDate();
            if (year.from) preset(year.from, today);
          }}
        >
          מתחילת השנה
        </Chip>
      </div>
      <p className="t-hint">מתאריך <bdi dir="ltr">{formatDisplay(from)}</bdi></p>
      <p className="t-hint">עד תאריך <bdi dir="ltr">{formatDisplay(to)}</bdi></p>
      <div className="band-row">
        <IconButton label="חודש קודם" onClick={() => { setCursor((current) => shiftMonth(current, -1)); }}>‹</IconButton>
        <p className="t-label">{monthTitle(cursor.year, cursor.month)}</p>
        <IconButton label="חודש הבא" disabled={nextDisabled} onClick={() => { setCursor((current) => shiftMonth(current, 1)); }}>›</IconButton>
      </div>
      <div className="ui-cal" role="grid" aria-label="טווח מותאם">
        {weeksOf(cells).map((week) => (
          <div key={week.join("-")} className="ui-cal-row" role="row">
            {week.map((iso) => {
              if (iso.slice(5, 7) !== monthKey) return <span key={iso} className="ui-day" />;
              const future = iso > today;
              const selected = iso === from || iso === to;
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  className="ui-day"
                  aria-label={dayLabel(iso)}
                  aria-selected={selected}
                  disabled={future}
                  onClick={() => { pick(iso); }}
                >
                  <b>{Number(iso.slice(8, 10))}</b>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <Button
        full
        onClick={() => {
          onApply(from, to);
          onOpenChange(false);
        }}
      >
        {days > 0 ? `הצגת ${String(days)} ימים` : "הצגה"}
      </Button>
    </Sheet>
  );
}

function weeksOf(cells: string[]): string[][] {
  const weeks: string[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function shiftMonth(cursor: { year: number; month: number }, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}
