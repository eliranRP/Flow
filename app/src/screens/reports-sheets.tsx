import { useEffect, useId, useRef, useState } from "react";
import {
  BALANCE_PRESETS,
  PNL_PRESETS,
  balanceDate,
  balancePresetLabel,
  pnlPresetLabel,
  pnlRange,
  rangeDays,
  type BalanceDate,
  type PnlPeriod,
} from "../reports";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { formatDisplay, monthTitle, shiftMonth } from "../ui/date-math";
import { ChevronIcon, OutwardChevron } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { ListRow } from "../ui/list-row";
import { MonthGrid } from "../ui/month-grid";
import { Sheet } from "../ui/sheet";

/**
 * FLOW-161: the reports' two sheets (boards ReportPeriodSheet, ReportCustomDates). The
 * period sheet leads with presets; "תאריכים אחרים" turns the same sheet into a range (or, for the balance sheet,
 * one date) on a month grid, with a back arrow to the presets: one sheet at a time (rule hierarchy § 10).
 */

function cursorOf(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

/** A month grid with its month switch; today and later days stay off (the books stop today). */
function CalendarPick({ label, today, value, range, onPick, start }: {
  label: string;
  today: string;
  value?: string | null;
  range?: { from: string; to: string } | null;
  onPick: (iso: string) => void;
  start: string;
}) {
  const [cursor, setCursor] = useState(() => cursorOf(start));
  const atToday = cursor.year === Number(today.slice(0, 4)) && cursor.month === Number(today.slice(5, 7)) - 1;
  return (
    <div className="ui-rep-cal">
      <div className="ui-band-row">
        <IconButton label="חודש קודם" onClick={() => { setCursor((current) => shiftMonth(current, -1)); }}>
          <OutwardChevron side="start" />
        </IconButton>
        <span className="t-line2 ui-date-title">{monthTitle(cursor.year, cursor.month)}</span>
        <IconButton label="חודש הבא" disabled={atToday} onClick={() => { setCursor((current) => shiftMonth(current, 1)); }}>
          <OutwardChevron side="end" />
        </IconButton>
      </div>
      <MonthGrid label={label} year={cursor.year} month={cursor.month} today={today} value={value} range={range} onPick={onPick} />
    </div>
  );
}

/** The P&L's period: presets, then a from/to range. */
export function PnlPeriodSheet({ open, onOpenChange, value, today, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PnlPeriod;
  today: string;
  onPick: (period: PnlPeriod) => void;
}) {
  const setOpen = useSheetHistory("report-period", open, onOpenChange);
  const [custom, setCustom] = useState(false);
  const start = pnlRange(value, today);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setCustom(value.kind === "custom");
    setFrom(start.from ?? `${today.slice(0, 7)}-01`);
    setTo(start.to ?? today);
    // Only reset when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const pick = (period: PnlPeriod) => {
    onPick(period);
    setOpen(false);
  };
  // A tap starts a new range on its day; the second tap ends it (or starts it again before the first).
  const tapDay = (iso: string) => {
    if (from == null || to == null || from !== to) {
      setFrom(iso);
      setTo(iso);
    } else if (iso < from) {
      setFrom(iso);
    } else {
      setTo(iso);
    }
  };
  const ready = from != null && to != null && from <= to;
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={custom ? "תאריכים אחרים" : "תקופה"}
      leading={custom ? (
        <IconButton label="חזרה לתקופות" onClick={() => { setCustom(false); }}>
          <OutwardChevron side="start" />
        </IconButton>
      ) : undefined}
      panelClassName="ui-sheet-choice ui-rep-sheet"
      action={custom ? (
        <Button full disabled={!ready} onClick={() => { if (ready) pick({ kind: "custom", from, to }); }}>
          {ready ? `הצגת ${formatDisplay(from).slice(0, 5)}–${formatDisplay(to).slice(0, 5)}` : "הצגה"}
        </Button>
      ) : undefined}
    >
      {custom ? (
        <div className="ui-rep-custom">
          <div className="ui-rep-fields">
            <span className="ui-rep-field">
              <span className="t-caption t-muted">מתאריך</span>
              <bdi className="ui-num" dir="ltr">{from == null ? "—" : formatDisplay(from)}</bdi>
            </span>
            <span className="ui-rep-field">
              <span className="t-caption t-muted">עד תאריך</span>
              <bdi className="ui-num" dir="ltr">{to == null ? "—" : formatDisplay(to)}</bdi>
            </span>
          </div>
          <CalendarPick label="טווח תאריכים" today={today} range={from != null && to != null ? { from, to } : null} onPick={tapDay} start={to ?? today} />
          <p className="t-caption t-muted ui-rep-days">{ready ? `${String(rangeDays(from, to))} ימים · נגיעה ביום מתחילה טווח חדש` : "בוחרים יום התחלה ויום סוף"}</p>
        </div>
      ) : (
        <div role="radiogroup" aria-label="תקופה" className="ui-choice-sheet">
          {PNL_PRESETS.map((kind) => {
            const words = pnlPresetLabel(kind, today);
            return <ListRow control="radio" key={kind} value={kind} title={words.label} description={words.dates} selected={value.kind === kind} onSelect={() => { pick({ kind }); }} />;
          })}
          <button type="button" className="ui-rep-more-row m-press" aria-pressed={value.kind === "custom"} onClick={() => { setCustom(true); }}>
            <span>תאריכים אחרים</span>
            <ChevronIcon size={18} />
          </button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * FLOW-1092 (the owner, 2026-11-07: "Move between months"): a drilled month's pill opens the report's months,
 * as the by-month view lists them; a pick opens that month's drill-down in its place.
 */
export function PnlMonthSheet({ open, onOpenChange, value, months, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drilled month, "2026-10". */
  value: string;
  months: readonly { key: string; name: string }[];
  onPick: (month: string) => void;
}) {
  const setOpen = useSheetHistory("report-month", open, onOpenChange);
  return (
    <Sheet open={open} onOpenChange={setOpen} title="חודש" panelClassName="ui-sheet-choice ui-rep-sheet">
      <div role="radiogroup" aria-label="חודש" className="ui-choice-sheet">
        {months.map((month) => (
          <ListRow control="radio" key={month.key} value={month.key} title={month.name} selected={month.key === value} onSelect={() => { onPick(month.key); setOpen(false); }} />
        ))}
      </div>
    </Sheet>
  );
}

/** Why the balance sheet has no "from the start": every date already is (FLOW-170). */
const BALANCE_FROM_START = "המאזן כולל את כל התנועות מההתחלה ועד התאריך שבוחרים";

/** The balance sheet's date: presets, then one day, each view with a line saying it counts from the start. */
export function BalanceDateSheet({ open, onOpenChange, value, today, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: BalanceDate;
  today: string;
  onPick: (asOf: BalanceDate) => void;
}) {
  const setOpen = useSheetHistory("report-date", open, onOpenChange);
  const noteId = useId();
  const [custom, setCustom] = useState(false);
  const [day, setDay] = useState(today);
  useEffect(() => {
    if (!open) return;
    setCustom(value.kind === "custom");
    setDay(balanceDate(value, today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const pick = (asOf: BalanceDate) => {
    onPick(asOf);
    setOpen(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={custom ? "תאריך אחר" : "נכון לתאריך"}
      leading={custom ? (
        <IconButton label="חזרה לתאריכים" onClick={() => { setCustom(false); }}>
          <OutwardChevron side="start" />
        </IconButton>
      ) : undefined}
      panelClassName="ui-sheet-choice ui-rep-sheet"
      action={custom ? <Button full onClick={() => { pick({ kind: "custom", date: day }); }}>{`הצגה נכון ל־${formatDisplay(day)}`}</Button> : undefined}
    >
      {custom ? (
        <div className="ui-rep-custom">
          <CalendarPick label="תאריך" today={today} value={day} onPick={setDay} start={day} />
          <p id={noteId} className="ui-rep-note">{BALANCE_FROM_START}</p>
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="נכון לתאריך" aria-describedby={noteId} className="ui-choice-sheet">
            {BALANCE_PRESETS.map((kind) => {
              const words = balancePresetLabel(kind, today);
              return <ListRow control="radio" key={kind} value={kind} title={words.label} description={words.dates} selected={value.kind === kind} onSelect={() => { pick({ kind }); }} />;
            })}
            <button type="button" className="ui-rep-more-row m-press" aria-pressed={value.kind === "custom"} onClick={() => { setCustom(true); }}>
              <span>תאריך אחר</span>
              <ChevronIcon size={18} />
            </button>
          </div>
          {/* FLOW-170 (owner, 2026-10-29: "why can't I choose all dates? From start"): a balance sheet already sums everything up to its date. */}
          <p id={noteId} className="ui-rep-note">{BALANCE_FROM_START}</p>
        </>
      )}
    </Sheet>
  );
}

/**
 * A sheet whose pick lands once it has closed: closing steps back over the sheet's history entry, which would
 * undo a URL written before it. `apply` writes the pick (a replace of the report's URL).
 */
export function useLatePick<T>(apply: (value: T) => void): { open: boolean; setOpen: (open: boolean) => void; onOpenChange: (open: boolean) => void; pick: (value: T) => void } {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ value: T } | null>(null);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next || pending.current == null) return;
    const { value } = pending.current;
    pending.current = null;
    // After the sheet's own clean-up of its history entry, which rewrites the URL as it was.
    queueMicrotask(() => { apply(value); });
  };
  return { open, setOpen, onOpenChange, pick: (value: T) => { pending.current = { value }; } };
}

