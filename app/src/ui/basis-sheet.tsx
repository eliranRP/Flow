import { RadioSheet, type RadioSheetCopy, type RadioSheetProps } from "./radio-sheet";

/** The company's one date for profit, the תזרים and the agent (FLOW-103, decision 0170). */
export const BASIS_CHOICES = [
  { value: "cash", label: "תאריך תשלום", description: "כשהכסף יצא או נכנס בבנק" },
  { value: "invoiced", label: "תאריך חשבונית", description: "לפי תאריך המסמך, גם לפני התשלום" },
] as const;

export type BasisChoice = (typeof BASIS_CHOICES)[number]["value"];

export const BASIS_TITLE = "רווח ותזרים לפי";
export const BASIS_SHEET_NOTE = "הרווח, התזרים והסוכן סופרים לפי התאריך הזה.";

const BASIS_COPY: RadioSheetCopy<BasisChoice> = {
  historyKey: "company-basis",
  title: BASIS_TITLE,
  note: BASIS_SHEET_NOTE,
  choices: BASIS_CHOICES,
};

/** "תאריך תשלום" for the cash basis, "תאריך חשבונית" for the invoiced one. */
export function basisChoiceLabel(basis: BasisChoice): string {
  return BASIS_CHOICES.find((choice) => choice.value === basis)?.label ?? basis;
}

/** The basis sheet (FLOW-103): two radio rows that apply on tap, like the currency sheet. */
export function BasisSheet(props: Omit<RadioSheetProps<BasisChoice>, "copy">) {
  return <RadioSheet {...props} copy={BASIS_COPY} />;
}
