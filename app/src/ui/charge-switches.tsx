import { HintParts } from "./hint-parts";
import { LockIcon, RepeatIcon, TransferIcon } from "./icons";
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
};

export const IN_CASH = "נספר בתזרים";
export const RECURRING = "חיוב קבוע";
/** FLOW-415 (b-2 addition): the same switch on an income line. */
export const RECURRING_INCOME = "הכנסה קבועה";

/** "כל חודש ב־4 · זוהה לבד", either half alone, or nothing. */
export function recurringHint(state: Pick<ChargeSwitchState, "typicalDay" | "detected">): string | undefined {
  const parts = [
    state.typicalDay == null ? null : `כל חודש ב־${String(state.typicalDay)}`,
    state.detected ? "זוהה לבד" : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(" · ") : undefined;
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
  busy = {},
  onCash,
  onRecurring,
}: {
  state: ChargeSwitchState;
  /** An income line reads הכנסה קבועה. */
  income?: boolean;
  /** A split whose parts differ on the cash view: locked, its parts decide (like נספר ברווח). */
  cashMixed?: boolean;
  /** No supplier or customer to mark: the recurring switch is locked off. */
  noParty?: boolean;
  disabled?: boolean;
  busy?: { cash?: boolean; recurring?: boolean };
  onCash: (next: boolean) => void;
  onRecurring: (next: boolean) => void;
}) {
  const hint = noParty ? "אין ספק או לקוח בשורה" : state.recurring ? recurringHint(state) : undefined;
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
      <Toggle
        label={income ? RECURRING_INCOME : RECURRING}
        hint={hint == null ? undefined : <HintParts text={hint} />}
        icon={<RepeatIcon />}
        checked={state.recurring}
        disabled={disabled}
        locked={noParty}
        busy={busy.recurring}
        onChange={onRecurring}
      />
    </>
  );
}
