import { type CategoryRow, type ExpectedParty, formatAmountText, type ProjectCategoryMonths } from "@flow/shared";
import { shortMonth } from "./party-charges";
import { type ForecastPace, monthIndex, type NextMonthForecast } from "./project-next-month";
import { HEBREW_MONTHS } from "./ui/date-math";

/**
 * The ProfitNextEdit and ProfitNextAdd pages' words and figures, pure: the pace sheet (כל כמה זמן), the
 * history bars of a category in the project, and the category sheet's two lists with their hints.
 */

/** The pace sheet's order, and each pace's name. */
export const FORECAST_PACES: readonly ForecastPace[] = ["once", "month", "2months", "quarter", "year"];
export const PACE_WORDS: Record<ForecastPace, string> = {
  once: "פעם אחת",
  month: "כל חודש",
  "2months": "כל חודשיים",
  quarter: "כל רבעון",
  year: "כל שנה",
};
const PACE_GAP: Record<ForecastPace, number> = { once: 0, month: 1, "2months": 2, quarter: 3, year: 12 };

/** "נובמבר" */
export function monthWord(month: string): string {
  return HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** yyyy-mm, n months after `month`. */
export function addMonths(month: string, n: number): string {
  const index = monthIndex(month) + n;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "דצמבר", or "נובמבר 2027" a year or more on: the month a pace comes back after `month`. */
export function paceNextMonth(pace: ForecastPace, month: string): string | null {
  if (pace === "once") return null;
  const gap = PACE_GAP[pace];
  const next = addMonths(month, gap);
  return gap >= 12 ? `${monthWord(next)} ${next.slice(0, 4)}` : monthWord(next);
}

/** The pace sheet's rows, from the forecast month: "פעם אחת · רק בנובמבר", "כל חודש · הבא בדצמבר", … */
export function paceChoices(month: string): Array<{ value: ForecastPace; label: string; description: string }> {
  return FORECAST_PACES.map((pace) => pace === "once"
    ? { value: pace, label: `פעם אחת · רק ב${monthWord(month)}`, description: "לא יחזור בצפי של החודשים הבאים" }
    : { value: pace, label: PACE_WORDS[pace], description: `הבא ב${paceNextMonth(pace, month) ?? ""}` });
}

/** The repeat row's title and the line under it. */
export function paceSummary(pace: ForecastPace, month: string, income: boolean): { title: string; sub: string } {
  if (pace === "once") return { title: "חד פעמי", sub: `רק בצפי של ${monthWord(month)}` };
  return {
    title: income ? "הכנסה קבועה בצפי" : "הוצאה קבועה בצפי",
    sub: `מ${monthWord(month)} · הבא ב${paceNextMonth(pace, month) ?? ""}`,
  };
}

/** The toast after a save: "עודכן לנובמבר: …", "עודכן כל רבעון: …". */
export function savedToast(pace: ForecastPace, month: string, name: string): string {
  return pace === "once" ? `עודכן ל${monthWord(month)}: ${name}` : `עודכן ${PACE_WORDS[pace]}: ${name}`;
}

/** The typed amount as the field shows it: digits, one point, two decimals, thousands commas. */
export function formatDraft(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, "");
  const point = cleaned.indexOf(".");
  const whole = (point < 0 ? cleaned : cleaned.slice(0, point)).replace(/^0+(?=\d)/, "").slice(0, 9);
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return point < 0 ? withCommas : `${withCommas}.${cleaned.slice(point + 1).replace(/\./g, "").slice(0, 2)}`;
}

/** The field's text for an amount in minor units ("1,200", "12.50"). */
export function draftOf(minor: bigint): string {
  const abs = minor < 0n ? -minor : minor;
  const cents = abs % 100n;
  return formatDraft(cents === 0n ? String(abs / 100n) : `${String(abs / 100n)}.${String(cents).padStart(2, "0")}`);
}

/** The currency's mark as the amounts write it ("$", "₪"). */
export function currencyMark(currency: string): string {
  return formatAmountText(100n, currency).replace(/[\d.,\s]/g, "");
}

export type HistoryBars = {
  /** The five latest complete months, oldest first. */
  months: Array<{ month: string; label: string; minor: bigint }>;
  /** Their average, rounded to the cent. */
  usual: bigint;
};

/**
 * A category's last five complete months in the project (project_category_months, expenses), or null when
 * it has none there. The forecast month's bar is the page's own.
 */
export function historyBars(months: ProjectCategoryMonths | null | undefined, categoryId: string | null, currency: string): HistoryBars | null {
  const category = months?.categories.find((row) => row.id === categoryId && row.currency === currency);
  if (category == null || months == null) return null;
  const values = category.months_minor.slice(-5);
  const keys = months.months.slice(-5);
  if (values.every((value) => value <= 0)) return null;
  const total = values.reduce((sum, value) => sum + BigInt(Math.max(value, 0)), 0n);
  const count = BigInt(values.length);
  return {
    months: values.map((value, index) => {
      const month = (keys[index] ?? "").slice(0, 7);
      return { month, label: shortMonth(month), minor: BigInt(Math.max(value, 0)) };
    }),
    usual: (total + count / 2n) / count,
  };
}

/** "כמו הרגיל", "גבוה ב־$890" or "נמוך ב־$40" against the usual month; `high` marks a jump of half or more. */
export function historyDiff(draft: bigint | null, usual: bigint, currency: string, month: string): { text: string; high: boolean } {
  if (draft == null || draft === 0n || usual === 0n) return { text: `הצפי ל${monthWord(month)} מסומן`, high: false };
  const gap = draft - usual;
  const abs = gap < 0n ? -gap : gap;
  if (abs < 500n) return { text: "כמו הרגיל", high: false };
  return { text: `${gap > 0n ? "גבוה ב־" : "נמוך ב־"}${formatAmountText(abs, currency)}`, high: draft * 2n > usual * 3n };
}

export type CategoryChoice = { id: string; name: string; kind: "expense" | "income"; hint: string };

/** The categories the forecast already counts: an average's own, a due charge's, an added line's. */
export function forecastCategoryIds(forecast: NextMonthForecast): Set<string> {
  return new Set(forecast.rows.flatMap((row) => (row.categoryId == null ? [] : [row.categoryId])));
}

/**
 * The category sheet: "מוצעות לפרויקט" are the categories the project used in the window, or that one of its
 * recurring charges files to, each with a hint; "כל הקטגוריות" is the rest of the company's list. Categories
 * the forecast counts, hidden ones, the loan principal and the ones kept out of the profit are left out.
 * A query keeps the names that contain it.
 */
export function categoryChoices(input: {
  categories: readonly CategoryRow[];
  categoryMonths: ProjectCategoryMonths | null | undefined;
  recurring: readonly ExpectedParty[];
  projectId: string;
  currency: string;
  divisor: number;
  inForecast: ReadonlySet<string>;
  query: string;
}): { suggested: CategoryChoice[]; rest: CategoryChoice[] } {
  const query = input.query.trim();
  const usable = input.categories.filter((category) => !category.hidden && category.loan_part !== "principal" && category.excluded_from_pnl !== true
    && !input.inForecast.has(category.id) && (query === "" || category.name.includes(query)));
  const charges = input.recurring.filter((party) => party.project_id === input.projectId && party.pays_loan !== true && party.currency === input.currency);
  const suggested: CategoryChoice[] = [];
  const rest: CategoryChoice[] = [];
  for (const category of usable) {
    const hint = suggestionHint(category.id, charges, input.categoryMonths, input.currency, input.divisor);
    if (hint != null) suggested.push({ id: category.id, name: category.name, kind: category.kind, hint });
    else rest.push({ id: category.id, name: category.name, kind: category.kind, hint: category.kind === "income" ? "הכנסה" : "אין תנועות בפרויקט" });
  }
  const byName = (a: CategoryChoice, b: CategoryChoice) => a.name.localeCompare(b.name, "he");
  return { suggested: suggested.sort(byName), rest: rest.sort(byName) };
}

/** "כל רבעון · $65" for a charge's category, "פעם אחת · $1,240 באפריל", or "ממוצע 6 חודשים בפרויקט: $305". */
function suggestionHint(
  categoryId: string,
  charges: readonly ExpectedParty[],
  months: ProjectCategoryMonths | null | undefined,
  currency: string,
  divisor: number,
): string | null {
  const charge = charges.find((party) => party.category_id === categoryId);
  if (charge != null) {
    const amount = charge.typical_amount_minor < 0n ? -charge.typical_amount_minor : charge.typical_amount_minor;
    return `${PACE_WORDS[charge.pace ?? "month"]} · ${formatAmountText(amount, currency)}`;
  }
  const row = months?.categories.find((category) => category.id === categoryId && category.currency === currency);
  if (row == null) return null;
  const seen = row.months_minor.map((value, index) => ({ value, index })).filter((item) => item.value > 0);
  const only = seen.length === 1 ? seen[0] : undefined;
  if (only != null) return `פעם אחת · ${formatAmountText(BigInt(only.value), currency)} ב${monthWord((months?.months[only.index] ?? "").slice(0, 7))}`;
  if (seen.length === 0) return null;
  const total = seen.reduce((sum, item) => sum + BigInt(item.value), 0n);
  const average = (total + BigInt(divisor) / 2n) / BigInt(divisor);
  return `ממוצע ${String(divisor)} חודשים בפרויקט: ${formatAmountText(average, currency)}`;
}
