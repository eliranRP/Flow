import type { RecurringPace } from "@flow/shared";
import { type ReactNode, useId } from "react";
import { HintParts } from "./hint-parts";
import { ChevronDownIcon, LockIcon, RepeatIcon, TransferIcon } from "./icons";
import { ListRow } from "./list-row";
import { Toggle } from "./toggle";

/** FLOW-415 (layout A): a payment's place in the cash view, and whether it is a recurring charge. */
export type ChargeSwitchState = {
  /** The payment counts in the cash view (תזרים). */
  inCash: boolean;
  /** The payment is a recurring charge. */
  recurring: boolean;
  /** The day of the month it usually comes, when the server knows one. */
  typicalDay: number | null;
  /** The server marked it recurring by itself, not the owner. */
  detected: boolean;
  /** How often it comes (FLOW-415, decision 0175); unknown reads as every month. */
  pace?: RecurringPace | null;
};

export const IN_CASH = "נספר בתזרים";
export const RECURRING = "חיוב קבוע";
/** FLOW-415 (b-2 addition): the same switch on an income line. */
export const RECURRING_INCOME = "הכנסה קבועה";

/** FLOW-415: the pace's words, on the hint, the "כל כמה זמן" sheet and the קבועים rows. */
export const PACE_LABEL: Record<RecurringPace, string> = {
  month: "כל חודש",
  "2months": "כל חודשיים",
  quarter: "כל רבעון",
  year: "כל שנה",
};

/** The pace sheet's title, and the name of the row that opens it. */
export const PACE_TITLE = "כל כמה זמן";

/** Pace first (design lead): "כל חודש · בערך ב־4 · זוהה לבד", with the day and זוהה לבד when known. */
export function recurringHint(state: Pick<ChargeSwitchState, "typicalDay" | "detected" | "pace">): string {
  return [
    PACE_LABEL[state.pace ?? "month"],
    state.typicalDay == null ? null : `בערך ב־${String(state.typicalDay)}`,
    state.detected ? "זוהה לבד" : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");
}

/** The undo toast's words after a pace change: "אור חשמל · כל חודשיים". */
export function paceToast(party: string, pace: RecurringPace): string {
  return `${party} · ${PACE_LABEL[pace]}`;
}

/** The undo toast's words after a switch: "אור חשמל · לא חיוב קבוע". */
export function chargeSwitchToast(party: string, kind: "cash" | "recurring" | "income", on: boolean): string {
  const word = kind === "cash" ? IN_CASH : kind === "income" ? RECURRING_INCOME : RECURRING;
  return `${party} · ${on ? word : `לא ${word}`}`;
}

/**
 * The two switches under נספר ברווח on a payment's page. They sit in the same grouped list, so
 * the caller renders them right after the P&L row. Each change is the caller's, with its undo toast.
 */
export function ChargeSwitches({
  state,
  income = false,
  cashMixed = false,
  noParty = false,
  disabled = false,
  recurringDisabled = false,
  busy = {},
  onCash,
  onRecurring,
  onPace,
}: {
  state: ChargeSwitchState;
  /** An income line reads הכנסה קבועה. */
  income?: boolean;
  /** A split whose parts differ on the cash view: locked, its parts decide (like נספר ברווח). */
  cashMixed?: boolean;
  /** No supplier or customer to mark: the recurring switch is locked off. */
  noParty?: boolean;
  disabled?: boolean;
  /** The recurring state could not be read, so the switch has nothing to change. */
  recurringDisabled?: boolean;
  busy?: { cash?: boolean; recurring?: boolean };
  onCash: (next: boolean) => void;
  onRecurring: (next: boolean) => void;
  /** Opens the "כל כמה זמן" sheet: a tap on the row while the switch is on. */
  onPace?: () => void;
}) {
  // The pace shows only while the switch is on (FLOW-415 D).
  const hint = noParty ? "אין ספק או לקוח בשורה" : state.recurring ? recurringHint(state) : undefined;
  const label = income ? RECURRING_INCOME : RECURRING;
  const opens = onPace != null && state.recurring && !noParty && !disabled && !recurringDisabled;
  return (
    <>
      {cashMixed ? (
        <ListRow variant="static" title={IN_CASH} icon={<LockIcon />} hint="לפי הקטגוריות בפיצול" />
      ) : (
        <Toggle
          label={IN_CASH}
          icon={<TransferIcon />}
          checked={state.inCash}
          disabled={disabled}
          busy={busy.cash}
          onChange={onCash}
        />
      )}
      {opens ? (
        <PaceSwitchRow label={label} hint={hint ?? ""} checked={state.recurring} busy={busy.recurring} onChange={onRecurring} onOpen={onPace} />
      ) : (
        <Toggle
          label={label}
          hint={hint == null ? undefined : <HintParts text={hint} />}
          icon={<RepeatIcon />}
          checked={state.recurring}
          disabled={disabled || recurringDisabled}
          locked={noParty}
          busy={busy.recurring}
          onChange={onRecurring}
        />
      )}
    </>
  );
}

/** Design lead: the pace part is the tap's cue, in accent text and ending in the sheet's ▾ (§3.7). */
function paceCueParts(hint: string): ReactNode[] {
  const [pace = "", ...rest] = hint.split(" · ");
  return [
    <span key="pace" className="ui-pace-cue">
      {pace}
      <ChevronDownIcon size={12} />
    </span>,
    ...rest,
  ];
}

/**
 * The recurring row while it is on: a tap on its words opens the pace sheet, and the switch at the
 * end still turns it off. The same row box and switch as Toggle; the two targets never overlap.
 */
function PaceSwitchRow({
  label,
  hint,
  checked,
  busy = false,
  onChange,
  onOpen,
}: {
  label: string;
  hint: string;
  checked: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  onOpen: () => void;
}) {
  const hintId = useId();
  return (
    <div className="ui-row ui-switch-row ui-switch-row-open">
      <button type="button" className="ui-row-main ui-switch-open" aria-haspopup="dialog" aria-describedby={hintId} onClick={onOpen}>
        <span className="ui-row-icon"><RepeatIcon /></span>
        <span className="ui-row-text">
          <span className="ui-row-title">{label}</span>
          <span id={hintId} className="ui-row-hint t-hint"><HintParts parts={paceCueParts(hint)} /></span>
        </span>
      </button>
      <label className="ui-switch-hit">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          aria-busy={busy || undefined}
          aria-label={label}
          aria-describedby={hintId}
          onChange={(event) => {
            if (busy) return;
            onChange(event.target.checked);
          }}
        />
        <span className="ui-switch" aria-hidden="true">
          <i />
        </span>
      </label>
    </div>
  );
}
