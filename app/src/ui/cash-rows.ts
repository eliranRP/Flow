import { formatAmountText } from "@flow/shared";

/** FLOW-413, frame b. The shape of a cash summary row: נכנס, יצא, רווח החודש, (FLOW-418) לא נספר ברווח, and a project's earlier months. */

/**
 * "in" is green; "net" (a month row) and "quiet" (רווח החודש) show a loss in red with its minus.
 * "aside" (FLOW-418, לא נספר ברווח) reads quiet and keeps its minus without red: it is not a loss.
 */
export type CashRowTone = "in" | "out" | "net" | "quiet" | "aside";

export type CashRow = {
  id: string;
  label: string;
  /** A short line under the label: FLOW-418 "שיפוץ והשבחה, השקעת בעלים", FLOW-417 "10 חודשים". */
  hint?: string;
  tone: CashRowTone;
  amounts: { currency: string; minor: bigint }[];
  /** Where the row opens. A row without one is a figure only (a year's נכנס and יצא). */
  href?: string;
  /** Read in full by a screen reader: "נכנס באוקטובר ₪18,000 – פירוט". */
  name: string;
};

/** The amounts as a screen reader hears them: a loss keeps its minus. */
export function cashAmountsText(amounts: { currency: string; minor: bigint }[]): string {
  return amounts.map((amount) => formatAmountText(amount.minor, amount.currency)).join(", ");
}
