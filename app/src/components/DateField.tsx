import { formatDayMonthYear, monthCells } from "@flow/shared";
import { useState } from "react";
import { israelToday } from "../period";

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => value || new Date().toISOString().slice(0, 10));
  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));
  const cells = monthCells(year, month);

  function shift(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    const iso = `${String(next.getUTCFullYear())}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
    setCursor(iso);
  }

  return (
    <div className="field">
      <span>{label}</span>
      <button type="button" className="btn-sec" onClick={() => { setOpen(true); }}>
        {value ? formatDayMonthYear(value) : "בחירת תאריך"}
      </button>
      <input type="hidden" value={value} required />
      {open ? (
        <div className="period-sheet" role="dialog" aria-label="תאריך">
          <div className="sheet-head">
            <h2 className="t-title-2">תאריך</h2>
            <button type="button" className="icon-btn" aria-label="סגירה" onClick={() => { setOpen(false); }}>
              סגירה
            </button>
          </div>
          <div className="choice-col">
            <button type="button" className="btn-sec" onClick={() => { onChange(israelToday()); setOpen(false); }}>
              היום
            </button>
          </div>
          <div className="date-nav">
            <button type="button" className="btn-sec" onClick={() => { shift(1); }}>החודש הבא</button>
            <button type="button" className="btn-sec" onClick={() => { shift(-1); }}>החודש הקודם</button>
          </div>
          <div className="date-grid" role="grid">
            {WEEKDAYS.map((day) => (
              <span key={day} className="t-hint">{day}</span>
            ))}
            {cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                className={cell.inMonth ? "date-day" : "date-day muted"}
                aria-pressed={cell.iso === value}
                onClick={() => {
                  onChange(cell.iso);
                  setOpen(false);
                }}
              >
                {cell.day}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RangeFields({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="stack">
      <DateField label="מתאריך" value={from} onChange={(next) => { onChange(next, to); }} />
      <DateField label="עד תאריך" value={to} onChange={(next) => { onChange(from, next); }} />
    </div>
  );
}
