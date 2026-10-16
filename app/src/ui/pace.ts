import type { RecurringPace } from "@flow/shared";
import type { ChoiceSheetCopy } from "./choice-sheet";

/**
 * FLOW-415 and FLOW-366: how often a payment comes. The pace's words are on the recurring row, the
 * "כל כמה זמן" sheet and the קבועים rows. לא קבוע is a sheet-only choice: it clears the recurring
 * flag (set_payment_recurring false) and has no pace on the server.
 */
export const PACE_LABEL: Record<RecurringPace, string> = {
  month: "כל חודש",
  "2months": "כל חודשיים",
  quarter: "כל רבעון",
  year: "כל שנה",
};

/** The pace sheet's title, and the name of the row that opens it. */
export const PACE_TITLE = "כל כמה זמן";

/** Shortest first, as the owner listed them (FLOW-415, 08:40Z). */
const PACE_CHOICES: readonly RecurringPace[] = ["month", "2months", "quarter", "year"];

/** The sheet's choices: a pace, or "never" (לא קבוע). */
export type PaceChoice = RecurringPace | "never";

/**
 * The "כל כמה זמן" sheet (FLOW-415 D, decision 0175; FLOW-366 adds לא קבוע). The note under לא קבוע
 * says what it does; the note under the pace the server detected says where it came from.
 */
export function paceSheetCopy(detected: RecurringPace | null): ChoiceSheetCopy<PaceChoice> {
  return {
    historyKey: "payment-pace",
    title: PACE_TITLE,
    choices: [
      { value: "never", label: "לא קבוע", description: "לא יופיע בקבועים" },
      ...PACE_CHOICES.map((pace) => ({
        value: pace,
        label: PACE_LABEL[pace],
        ...(pace === detected ? { description: "זוהה לבד מהתשלומים הקודמים" } : {}),
      })),
    ],
  };
}

/** The undo toast's words after a pace is saved: "נשמר: כל רבעון". */
export function paceToast(pace: RecurringPace): string {
  return `נשמר: ${PACE_LABEL[pace]}`;
}
