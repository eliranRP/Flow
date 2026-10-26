import { formatAmountText, type ProfitMonth } from "@flow/shared";
import { CHART_MONTHS, type MonthFigures } from "./month-figures";
import { shortMonth } from "./party-charges";
import { shiftMonthKey } from "./period";
import { monthWord } from "./project-next-edit";
import type { NextMonthForecast } from "./project-next-month";
import { forecastWords, type ForecastKind } from "./ui/forecast-words";
import type { ChartMonth } from "./ui/month-chart-scale";

/**
 * What the next-month card and the month chart say (canvas note spec-fcwide), pure: the chart's months
 * from a page's own history (the profit page's profit months, the project page's cash months), its sub and
 * spoken label, and the card's two captions from the forecast the צפי page shows.
 */

export type ChartHistory = {
  /** Oldest first. */
  months: ChartMonth[];
  /** The window starts at the project's first month, so it holds fewer than six. */
  fromStart: boolean;
};

const EMPTY: MonthFigures = { incomeMinor: 0n, expenseMinor: 0n };

/** A profit page's history from get_profit_months: each month's income and counted expenses in one currency. */
export function profitMonthFigures(months: readonly ProfitMonth[], currency: string): Map<string, MonthFigures> {
  const figures = new Map<string, MonthFigures>();
  for (const month of months) {
    const row = month.by_currency.find((figure) => figure.currency === currency);
    if (row == null) continue;
    figures.set(month.month, { incomeMinor: row.income_minor, expenseMinor: row.expense_minor < 0n ? -row.expense_minor : row.expense_minor });
  }
  return figures;
}

/**
 * The six months to `current` (yyyy-mm), oldest first, each with its figures (none read is zero). A month
 * before the project's first one drops out; with that month unknown, the empty months at the window's start
 * do. The current month always stays.
 */
export function chartHistory(current: string, figures: ReadonlyMap<string, MonthFigures>, firstMonth: string | null): ChartHistory {
  const keys = Array.from({ length: CHART_MONTHS }, (_, index) => shiftMonthKey(current, index - (CHART_MONTHS - 1)));
  let start = 0;
  if (firstMonth != null) {
    while (start < keys.length - 1 && (keys[start] ?? "") < firstMonth) start += 1;
  } else {
    while (start < keys.length - 1) {
      const month = figures.get(keys[start] ?? "");
      if (month != null && (month.incomeMinor !== 0n || month.expenseMinor !== 0n)) break;
      start += 1;
    }
  }
  const months = keys.slice(start).map((key) => ({ key, label: shortMonth(key), ...(figures.get(key) ?? EMPTY) }));
  return { months, fromStart: start > 0 };
}

/** The forecast's bar pair: "נוב׳ · צפי". */
export function forecastChartMonth(forecast: Pick<NextMonthForecast, "month" | "incomeMinor" | "expenseMinor">): ChartMonth {
  return { key: forecast.month, label: `${shortMonth(forecast.month)} · צפי`, incomeMinor: forecast.incomeMinor, expenseMinor: forecast.expenseMinor };
}

function rangeWords(history: ChartHistory): string {
  if (history.fromStart) return "מתחילת הפרויקט";
  const first = history.months[0]?.key ?? "";
  const last = history.months.at(-1)?.key ?? "";
  return `${monthWord(first)} עד ${monthWord(last)}`;
}

/** The chart's sub: "מאי עד אוקטובר וצפי", or "מתחילת הפרויקט וצפי" for a younger project. */
export function chartSub(history: ChartHistory, withForecast: boolean): string {
  return withForecast ? `${rangeWords(history)} וצפי` : rangeWords(history);
}

/**
 * The one label a screen reader hears for the chart, in the page's words (a cash view's נכנס and יצא, a
 * profit view's הכנסות and הוצאות). `subject` names whose figures they are ("הכנסות והוצאות של החברה" on the
 * company page); by default it is the chart's title. FLOW-961: it reads every month's two figures, as the
 * bars show them, and next month's as the forecast.
 */
export function chartLabel(history: ChartHistory, forecast: ChartMonth | null, currency: string, kind: ForecastKind = "profit", subject?: string): string {
  const words = forecastWords(kind);
  const pair = (month: ChartMonth) => `${words.incomeShort} ${formatAmountText(month.incomeMinor, currency)}, ${words.expenseShort} ${formatAmountText(month.expenseMinor, currency)}`;
  const months = history.months.map((month) => `${monthWord(month.key)}: ${pair(month)}`);
  const ahead = forecast == null ? [] : [`צפי ${monthWord(forecast.key)}: ${pair(forecast)}`];
  return [`${subject ?? words.chart}, ${rangeWords(history)}`, ...months, ...ahead].join(". ");
}

/**
 * FLOW-961: the project chart's title says what it shows: the month to date, "אוקטובר: יצא $14,253 יותר
 * משנכנס". Null with no month.
 */
export function cashTakeaway(history: ChartHistory, currency: string): string | null {
  const month = history.months.at(-1);
  if (month == null) return null;
  const name = monthWord(month.key);
  const diff = month.incomeMinor - month.expenseMinor;
  if (diff === 0n) return month.incomeMinor === 0n ? `${name}: לא נכנס ולא יצא כסף` : `${name}: נכנס בדיוק מה שיצא`;
  return diff < 0n
    ? `${name}: יצא ${formatAmountText(-diff, currency)} יותר משנכנס`
    : `${name}: נכנס ${formatAmountText(diff, currency)} יותר משיצא`;
}

/** A company category as the income caption reads it: its name, and its parent's id when it has one. */
export type RentCategory = { id: string; name: string; parent_id?: string | null };

/** A rent category: the starter set's שכירות, one the user named after it, or a sub-category of one. */
export function isRent(categoryId: string | null, categories: readonly RentCategory[]): boolean {
  if (categoryId == null) return false;
  const category = categories.find((row) => row.id === categoryId);
  if (category == null) return false;
  if (category.name.startsWith("שכירות")) return true;
  const parent = category.parent_id == null ? null : categories.find((row) => row.id === category.parent_id);
  return parent?.name.startsWith("שכירות") === true;
}

/**
 * Under הכנסות צפויות, what the expected income is made of: "2 שכירויות קבועות" for recurring rent, "2
 * הכנסות קבועות" for other recurring income, a single other line by its name, else the count.
 */
export function incomeNote(forecast: Pick<NextMonthForecast, "rows">, categories: readonly RentCategory[]): string {
  const rows = forecast.rows.filter((row) => row.minor > 0n);
  const count = rows.length;
  if (count === 0) return "אין הכנסה צפויה";
  if (rows.every((row) => row.kind === "recurring")) {
    if (rows.every((row) => isRent(row.categoryId, categories))) return count === 1 ? "שכירות קבועה אחת" : `${String(count)} שכירויות קבועות`;
    return count === 1 ? "הכנסה קבועה אחת" : `${String(count)} הכנסות קבועות`;
  }
  if (count === 1) return rows[0]?.name ?? "";
  return `${String(count)} הכנסות צפויות`;
}

/**
 * Under הוצאות צפויות: "מול $1,740 בספטמבר", the last full month's expenses on the page's own history; "אין
 * הוצאות צפויות" when none are expected; the count when the project had no such month yet.
 */
export function expenseNote(
  forecast: Pick<NextMonthForecast, "month" | "rows" | "expenseMinor">,
  history: ChartHistory,
  currency: string,
): string {
  if (forecast.expenseMinor === 0n) return "אין הוצאות צפויות";
  const previous = shiftMonthKey(forecast.month, -2);
  const month = history.months.find((row) => row.key === previous);
  if (month == null) {
    const costs = forecast.rows.filter((row) => row.minor < 0n);
    // In cash terms the loans' principal is an expense no row holds (cashForecast): it counts as one more.
    const inRows = costs.reduce((sum, row) => sum - row.minor, 0n);
    const count = costs.length + (forecast.expenseMinor > inRows ? 1 : 0);
    return count === 1 ? "הוצאה צפויה אחת" : `${String(count)} הוצאות צפויות`;
  }
  return `מול ${formatAmountText(month.expenseMinor, currency)} ב${monthWord(previous)}`;
}
