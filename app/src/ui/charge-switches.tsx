import { HintParts } from "./hint-parts";
import { RepeatIcon, TransferIcon } from "./icons";
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
};

export const IN_CASH = "נספר בתזרים";
export const RECURRING = "חיוב קבוע";

/** "בדרך כלל ב־4 לחודש · זוהה לבד", either half alone, or nothing. */
export function recurringHint(state: Pick<ChargeSwitchState, "typicalDay" | "detected">): string | undefined {
  const parts = [
    state.typicalDay == null ? null : `בדרך כלל ב־${String(state.typicalDay)} לחודש`,
    state.detected ? "זוהה לבד" : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The undo toast's words after a switch: "אור חשמל · לא חיוב קבוע". */
export function chargeSwitchToast(party: string, kind: "cash" | "recurring", on: boolean): string {
  const word = kind === "cash" ? IN_CASH : RECURRING;
  return `${party} · ${on ? word : `לא ${word}`}`;
}

/**
 * The two switches under נספר ברווח on a payment's page. They sit in the same grouped list, so
 * the caller renders them right after the P&L row. Each change is the caller's, with its undo toast.
 */
export function ChargeSwitches({
  state,
  disabled = false,
  busy = {},
  onCash,
  onRecurring,
}: {
  state: ChargeSwitchState;
  disabled?: boolean;
  busy?: { cash?: boolean; recurring?: boolean };
  onCash: (next: boolean) => void;
  onRecurring: (next: boolean) => void;
}) {
  const hint = recurringHint(state);
  return (
    <>
      <Toggle
        label={IN_CASH}
        icon={<TransferIcon />}
        checked={state.inCash}
        disabled={disabled}
        busy={busy.cash}
        onChange={onCash}
      />
      <Toggle
        label={RECURRING}
        hint={hint == null ? undefined : <HintParts text={hint} />}
        icon={<RepeatIcon />}
        checked={state.recurring}
        disabled={disabled}
        busy={busy.recurring}
        onChange={onRecurring}
      />
    </>
  );
}
