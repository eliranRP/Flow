import { type RefObject } from "react";
import { ChartIcon } from "./icons";
import { IconRow } from "./icon-row";
import { Sheet } from "./sheet";
import { Toggle } from "./toggle";

/**
 * FLOW-366 (guide §7.10, decision 0170): where a line is counted. The P&L and the cash view are two
 * switches on the line; the row shows the result in one line, and its sheet sets each switch.
 */

/** The reason a line is out of the P&L, as the row and the sheet name it. */
export const COUNTED_REASON_LOAN = "קרן הלוואה";
export const COUNTED_REASON_RENO = "שיפוץ";
export const COUNTED_REASON_OTHER = "הוצא מהרווח";

/**
 * The row's value for the two switches: "רווח ותזרים" when both count; otherwise what is left, with
 * the reason on the side that is out of profit ("תזרים בלבד · <reason>"). Accent when something is off.
 */
export function countedInValue(pnl: boolean, cash: boolean, reason: string | null): { text: string; off: boolean } {
  if (pnl && cash) return { text: "רווח ותזרים", off: false };
  if (!pnl && cash) return { text: `תזרים בלבד · ${reason ?? COUNTED_REASON_OTHER}`, off: true };
  if (pnl && !cash) return { text: "רווח בלבד · לא בתזרים", off: true };
  return { text: "לא נספר", off: true };
}

/** The sub line under the P&L switch: what decides it, or why it is off. */
function pnlSub(pnl: boolean, reason: string | null): string {
  if (pnl) return "לפי הקטגוריה";
  if (reason === COUNTED_REASON_LOAN) return "קרן הלוואה מקטינה חוב, היא לא הוצאה";
  if (reason === COUNTED_REASON_RENO) return "שיפוץ נכנס לעלות הנכס, לא להוצאות";
  return "כבוי לשורה הזו";
}

/** The counted-in row: an IconRow with ChartIcon, opening the sheet; static when the line is locked. */
export function CountedInRow({
  pnl,
  cash,
  reason,
  locked = false,
  lockedHint,
  disabled = false,
  busy = false,
  onOpen,
  buttonRef,
}: {
  pnl: boolean;
  cash: boolean;
  reason: string | null;
  /** A loan line or a mixed split: its P&L is set by its parts, so the row only says so. */
  locked?: boolean;
  /** The row's hint while it is locked (the loan's parts, or the split's categories). */
  lockedHint?: string;
  disabled?: boolean;
  busy?: boolean;
  onOpen: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const value = countedInValue(pnl, cash, reason);
  const hint = locked ? (lockedHint ?? reason ?? undefined) : undefined;
  if (locked) {
    return <IconRow icon={<ChartIcon />} label="נספר ב" value={value.text} hint={hint} />;
  }
  return (
    <IconRow
      icon={<ChartIcon />}
      label="נספר ב"
      value={value.text}
      valueTone={value.off ? "accent" : undefined}
      disabled={disabled}
      busy={busy}
      onClick={onOpen}
      buttonRef={buttonRef}
    />
  );
}

/** The sheet: two switch rows, and the note that says the change is for this line only. */
export function CountedInSheet({
  open,
  onOpenChange,
  pnl,
  cash,
  reason,
  busy = false,
  onPnl,
  onCash,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pnl: boolean;
  cash: boolean;
  reason: string | null;
  busy?: boolean;
  onPnl: (next: boolean) => void;
  onCash: (next: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="איפה השורה נספרת" returnFocusRef={returnFocusRef}>
      <div className="ui-counted-sheet">
        <CountedSwitch label="נספר ברווח" sub={pnlSub(pnl, reason)} checked={pnl} busy={busy} onChange={onPnl} />
        <CountedSwitch label="נספר בתזרים" sub="כסף שזז בבנק. כבוי רק להעברות בין החשבונות שלך" checked={cash} busy={busy} onChange={onCash} />
        <p className="ui-counted-note t-caption">רק השורה הזו. הקטגוריה לא משתנה.</p>
      </div>
    </Sheet>
  );
}

/** One switch row: its title, its sub line, and the switch itself (46×28, 150ms). */
function CountedSwitch({ label, sub, checked, busy, onChange }: { label: string; sub: string; checked: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="ui-counted-switch">
      <Toggle label={label} hint={sub} checked={checked} busy={busy} onChange={onChange} />
    </div>
  );
}
