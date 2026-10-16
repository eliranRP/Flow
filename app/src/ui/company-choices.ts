import type { ChoiceSheetCopy } from "./choice-sheet";

/** The currencies a company can keep its books in (decision 0147). */
export const CURRENCY_CHOICES = [
  { value: "ILS", label: "₪ שקל" },
  { value: "USD", label: "$ דולר" },
] as const;

export type CurrencyChoice = (typeof CURRENCY_CHOICES)[number]["value"];

export const CURRENCY_SHEET_NOTE =
  "המטבע הזה מוצג ראשון, ובו מתחילים פרויקטים והלוואות חדשים. הסכומים לא מומרים: תנועות במטבע אחר מוצגות בשורה משלהן.";

/** "₪ שקל" for a known currency, else the code itself. */
export function currencyChoiceLabel(currency: string): string {
  return CURRENCY_CHOICES.find((choice) => choice.value === currency)?.label ?? currency;
}

/** The company's one date for profit, the תזרים and the agent (FLOW-103, decision 0170). */
export const BASIS_CHOICES = [
  { value: "cash", label: "תאריך תשלום", description: "כשהכסף יצא או נכנס בבנק" },
  { value: "invoiced", label: "תאריך חשבונית", description: "לפי תאריך המסמך, גם לפני התשלום" },
] as const;

export type BasisChoice = (typeof BASIS_CHOICES)[number]["value"];

export const BASIS_TITLE = "רווח ותזרים לפי";
export const BASIS_SHEET_NOTE = "הרווח, התזרים והסוכן סופרים לפי התאריך הזה.";

/** "תאריך תשלום" for the cash basis, "תאריך חשבונית" for the invoiced one. */
export function basisChoiceLabel(basis: BasisChoice): string {
  return BASIS_CHOICES.find((choice) => choice.value === basis)?.label ?? basis;
}

/** The company currency sheet's words (FLOW-504): its history entry, title, note and rows. */
export const CURRENCY_COPY: ChoiceSheetCopy<CurrencyChoice> = {
  historyKey: "company-currency",
  title: "מטבע העסק",
  note: CURRENCY_SHEET_NOTE,
  choices: CURRENCY_CHOICES,
};

/** The company basis sheet's words (FLOW-103). */
export const BASIS_COPY: ChoiceSheetCopy<BasisChoice> = {
  historyKey: "company-basis",
  title: BASIS_TITLE,
  note: BASIS_SHEET_NOTE,
  choices: BASIS_CHOICES,
};
