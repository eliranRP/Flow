import { useState } from "react";
import { Button } from "./button";
import { dayLabel, formatDisplay, israelToday, monthCells, monthTitle } from "./date-math";
import { IconButton } from "./icon-button";
import { Sheet } from "./sheet";

type DatePickerProps = {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
};

export function DatePicker({ label, value, onChange }: DatePickerProps) {
  const today = israelToday();
  const [open, setOpen] = useState(false);
  const initial = value ?? today;
  const [cursor, setCursor] = useState(() => parseCursor(initial));
  const cells = monthCells(cursor.year, cursor.month);
  const nextDisabled = cursor.year > Number(today.slice(0, 4)) || (cursor.year === Number(today.slice(0, 4)) && cursor.month >= Number(today.slice(5, 7)) - 1);

  function pick(iso: string) {
    if (iso > today) return;
    onChange(iso);
  }

  return (
    <>
      <button type="button" className="ui-field ui-hit" aria-haspopup="dialog" onClick={() => { setOpen(true); }}>
        <span className="ui-field-label">{label}</span>
        <span className="ui-field-control">
          <bdi dir="ltr">{value ? formatDisplay(value) : "בחירת תאריך"}</bdi>
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={label}>
        <div className="band-row">
          <IconButton
            label="חודש קודם"
            onClick={() => {
              setCursor((current) => shiftMonth(current, -1));
            }}
          >
            ‹
          </IconButton>
          <p className="t-label">{monthTitle(cursor.year, cursor.month)}</p>
          <IconButton
            label="חודש הבא"
            disabled={nextDisabled}
            onClick={() => {
              setCursor((current) => shiftMonth(current, 1));
            }}
          >
            ›
          </IconButton>
        </div>
        <div className="ui-cal" role="grid" aria-label={label}>
          <div className="ui-cal-row" role="row">
            {["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map((head) => (
              <span key={head} className="ui-cal-head" role="columnheader">
                {head}
              </span>
            ))}
          </div>
          {weeksOf(cells).map((week) => (
            <div key={week.join("-")} className="ui-cal-row" role="row">
              {week.map((iso) => {
                const outside = iso.slice(5, 7) !== String(cursor.month + 1).padStart(2, "0");
                const future = iso > today;
                return (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    className={outside ? "ui-day ui-day-outside" : "ui-day"}
                    aria-label={dayLabel(iso)}
                    aria-selected={iso === value}
                    aria-current={iso === today ? "date" : undefined}
                    disabled={future}
                    onClick={() => {
                      pick(iso);
                    }}
                  >
                    {Number(iso.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <Button
          variant="primary"
          full
          onClick={() => {
            setOpen(false);
          }}
        >
          בחירה
        </Button>
      </Sheet>
    </>
  );
}

function weeksOf(cells: string[]): string[][] {
  const weeks: string[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function parseCursor(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

function shiftMonth(cursor: { year: number; month: number }, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}
