import type { CashMonths } from "@flow/shared";
import { cashMonthKey } from "./cash";

/**
 * The month chart's history length and a month's figures. Kept apart from next-month-chart.ts because
 * project-cash.ts needs them and Home's entry reaches project-cash.ts (prefetch.tsx): importing them from
 * next-month-chart.ts pulled the chart, the forecast and the loan outlook into Home's first load (FLOW-804).
 */

/** The chart's history: the current month, to date, and the five before it. */
export const CHART_MONTHS = 6;

/** A month's two figures, positive, in minor units. */
export type MonthFigures = { incomeMinor: bigint; expenseMinor: bigint };

/** A month chart's history from cash months (the company's or a project's): each month's נכנס and יצא in the currency. */
export function cashMonthFigures(data: NonNullable<CashMonths>, currency: string): Map<string, MonthFigures> {
  const figures = new Map<string, MonthFigures>();
  for (const month of data.months) {
    const row = month.by_currency.find((figure) => figure.currency === currency);
    if (row != null) figures.set(cashMonthKey(month.month), { incomeMinor: row.in_minor, expenseMinor: row.out_minor });
  }
  return figures;
}
