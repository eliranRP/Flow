import type { ChoiceSheetCopy } from "./choice-sheet";

/**
 * The currencies a company can keep its books in (decision 0147). `label` is the row's value on
 * the העסק page; `sheetLabel` and `description` are the sheet's row (FLOW-512).
 */
export const CURRENCY_CHOICES = [
  { value: "ILS", label: "₪ שקל", sheetLabel: "שקל · ₪", description: "שורות בדולר מומרות לפי שער היום" },
  { value: "USD", label: "$ דולר", sheetLabel: "דולר · $", description: "שורות בשקל מומרות לפי שער היום" },
] as const;

export type CurrencyChoice = (typeof CURRENCY_CHOICES)[number]["value"];

export const CURRENCY_TITLE = "מטבע העסק";

/** "₪ שקל" for a known currency, else the code itself. */
export function currencyChoiceLabel(currency: string): string {
  return CURRENCY_CHOICES.find((choice) => choice.value === currency)?.label ?? currency;
}

/** The company's one date for profit, the תזרים and the agent (FLOW-103, decision 0170). */
export const BASIS_CHOICES = [
  { value: "cash", label: "תאריך תשלום", description: "הכנסה נספרת כשהכסף נכנס, הוצאה כשהיא שולמה." },
  { value: "invoiced", label: "תאריך חשבונית", description: "נספר לפי תאריך המסמך, גם אם עוד לא שולם." },
] as const;

export type BasisChoice = (typeof BASIS_CHOICES)[number]["value"];

export const BASIS_TITLE = "רווח ותזרים לפי";
export const BASIS_SHEET_SUBTITLE = "חל על כל החברה";
/** The profit page's sheet names where the date counts (board ProfitBasis); Settings keeps the short copy. */
export const BASIS_PROFIT_SUBTITLE = "חל על כל החברה, בבית, בפרויקטים ובדוחות";
const BASIS_PROFIT_CASH_DESCRIPTION = "הכנסה נספרת כשהכסף נכנס, הוצאה כשהיא שולמה. חשבונית פתוחה עוד לא נספרת.";

/** "תאריך תשלום" for the cash basis, "תאריך חשבונית" for the invoiced one. */
export function basisChoiceLabel(basis: BasisChoice): string {
  return BASIS_CHOICES.find((choice) => choice.value === basis)?.label ?? basis;
}

/** The company currency sheet's words (FLOW-504, FLOW-512): its history entry, title and rows. */
export const CURRENCY_COPY: ChoiceSheetCopy<CurrencyChoice> = {
  historyKey: "company-currency",
  title: CURRENCY_TITLE,
  choices: CURRENCY_CHOICES.map((choice) => ({ value: choice.value, label: choice.sheetLabel, description: choice.description })),
};

/** The company basis sheet's words (FLOW-103). */
export const BASIS_COPY: ChoiceSheetCopy<BasisChoice> = {
  historyKey: "company-basis",
  title: BASIS_TITLE,
  subtitle: BASIS_SHEET_SUBTITLE,
  choices: BASIS_CHOICES,
};

/** The same sheet opened from the profit page (board ProfitBasis): the longer subtitle and cash note. */
export const BASIS_PROFIT_COPY: ChoiceSheetCopy<BasisChoice> = {
  ...BASIS_COPY,
  subtitle: BASIS_PROFIT_SUBTITLE,
  choices: BASIS_CHOICES.map((choice) => (choice.value === "cash" ? { ...choice, description: BASIS_PROFIT_CASH_DESCRIPTION } : choice)),
};
