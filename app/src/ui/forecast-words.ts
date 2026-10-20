/**
 * The forecast card's and the month chart's words (canvas note spec-cash2): the parts are the same on every
 * screen, only the words change. A cash view says נכנס / יצא / תזרים; a profit view הכנסות / הוצאות / רווח
 * (DESIGN-RULES, Money terms).
 */

export type ForecastKind = "cash" | "profit";

export type ForecastWords = {
  /** The card's two columns. */
  income: string;
  expense: string;
  /** The card's net, unless the screen names it ("תזרים בסוף אוקטובר"). */
  net: string;
  /** The chart's title, also the start of its spoken label. */
  chart: string;
  /** The legend's swatches, and the chart label's two figures. */
  incomeShort: string;
  expenseShort: string;
};

const WORDS: Record<ForecastKind, ForecastWords> = {
  cash: { income: "צפוי להיכנס", expense: "צפוי לצאת", net: "תזרים צפוי", chart: "נכנס ויצא לפי חודש", incomeShort: "נכנס", expenseShort: "יצא" },
  profit: { income: "הכנסות צפויות", expense: "הוצאות צפויות", net: "רווח צפוי", chart: "הכנסות והוצאות לפי חודש", incomeShort: "הכנסות", expenseShort: "הוצאות" },
};

export function forecastWords(kind: ForecastKind): ForecastWords {
  return WORDS[kind];
}
