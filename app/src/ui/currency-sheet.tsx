import { ChoiceSheet, type ChoiceSheetCopy, type ChoiceSheetProps } from "./choice-sheet";

/** The currencies a company can keep its books in (decision 0147). */
export const CURRENCY_CHOICES = [
  { value: "ILS", label: "₪ שקל" },
  { value: "USD", label: "$ דולר" },
] as const;

export type CurrencyChoice = (typeof CURRENCY_CHOICES)[number]["value"];

export const CURRENCY_SHEET_NOTE =
  "המטבע הזה מוצג ראשון, ובו מתחילים פרויקטים והלוואות חדשים. הסכומים לא מומרים: תנועות במטבע אחר מוצגות בשורה משלהן.";

const CURRENCY_COPY: ChoiceSheetCopy<CurrencyChoice> = {
  historyKey: "company-currency",
  title: "מטבע העסק",
  note: CURRENCY_SHEET_NOTE,
  choices: CURRENCY_CHOICES,
};

/** "₪ שקל" for a known currency, else the code itself. */
export function currencyChoiceLabel(currency: string): string {
  return CURRENCY_CHOICES.find((choice) => choice.value === currency)?.label ?? currency;
}

/** The company currency sheet (FLOW-504): two radio rows that apply on tap, like the period sheet. */
export function CurrencySheet(props: Omit<ChoiceSheetProps<CurrencyChoice, string>, "copy">) {
  return <ChoiceSheet {...props} copy={CURRENCY_COPY} />;
}
