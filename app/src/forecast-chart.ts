import { formatAmountText, type ForecastBuild } from "@flow/shared";
import type { MonthFigures } from "./month-figures";
import { chartHistory } from "./next-month-chart";
import { shortMonth } from "./party-charges";
import { monthWord } from "./project-next-edit";
import { itemLate } from "./screens/forecast-parts";
import type { ChartMonth } from "./ui/month-chart-scale";

/**
 * What תזרים צפוי's card and chart say (canvas note spec-cash2, the MonthForecast board's `cf`), pure: the
 * honest counts under the card's two figures and in its corner, and the chart's months, May to September as
 * they ended and October in progress (so far, plus what is still expected), with its sub and spoken label.
 */

function items(count: number): string {
  return count === 1 ? "פריט אחד" : `${String(count)} פריטים`;
}

function counted(build: Pick<ForecastBuild, "income" | "expense" | "small">) {
  return { income: build.income, expense: [...build.expense, ...build.small] };
}

/** The card's corner: every item still expected this month, "11 פריטים · פירוט למטה". */
export function itemsCaption(build: Pick<ForecastBuild, "income" | "expense" | "small">): string {
  const { income, expense } = counted(build);
  return `${items(income.length + expense.length)} · פירוט למטה`;
}

/** Under צפוי להיכנס: "3 פריטים · 2 באיחור" (late as the rows say it), or the count alone when none is late. */
export function incomeCountNote(build: Pick<ForecastBuild, "income" | "expense" | "small">, today: string): string {
  const { income } = counted(build);
  if (income.length === 0) return "אין הכנסה צפויה";
  const late = income.filter((item) => itemLate(item, today)).length;
  if (late === 0) return items(income.length);
  return `${items(income.length)} · ${late === 1 ? "אחד" : String(late)} באיחור`;
}

/** Under צפוי לצאת: "8 פריטים, מהם 6 קבועים", the small charges counted with the rest. */
export function expenseCountNote(build: Pick<ForecastBuild, "income" | "expense" | "small">): string {
  const { expense } = counted(build);
  if (expense.length === 0) return "אין הוצאה צפויה";
  const recurring = expense.filter((item) => item.kind === "recurring").length;
  if (expense.length === 1) return recurring === 1 ? "פריט אחד, קבוע" : "פריט אחד";
  if (recurring === 0) return items(expense.length);
  if (recurring === expense.length) return `${items(expense.length)}, כולם קבועים`;
  return `${items(expense.length)}, ${recurring === 1 ? "מהם אחד קבוע" : `מהם ${String(recurring)} קבועים`}`;
}

export type MonthEndChart = { months: ChartMonth[]; sub: string; label: string };

/**
 * The chart: the cash months to `month` (yyyy-mm) as they ended, the empty ones at the window's start left
 * out, and `month` itself in progress: its figures so far (`figures` holds them, to date) with `ahead`, the
 * forecast's remaining income and expenses, as the dashed cap.
 */
export function monthEndChart(month: string, figures: ReadonlyMap<string, MonthFigures>, ahead: MonthFigures, currency: string): MonthEndChart {
  const history = chartHistory(month, figures, null).months;
  const months = history.map((row) => (row.key === month ? { ...row, label: `${shortMonth(month)} · צפי`, ahead } : row));
  const now = months.at(-1);
  const first = months[0]?.key ?? month;
  const sub = first === month ? `עד סוף ${monthWord(month)}` : `${monthWord(first)} עד סוף ${monthWord(month)}`;
  const money = (minor: bigint) => formatAmountText(minor, currency);
  const label = `נכנס ויצא לפי חודש, ${sub}. ${monthWord(month)} עד היום: נכנס ${money(now?.incomeMinor ?? 0n)}, יצא ${money(now?.expenseMinor ?? 0n)}; צפוי עוד: נכנס ${money(ahead.incomeMinor)}, יצא ${money(ahead.expenseMinor)}`;
  return { months, sub, label };
}
