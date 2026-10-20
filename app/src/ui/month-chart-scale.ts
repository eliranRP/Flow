/**
 * The income and expense chart's bar heights (Profit and Projects boards, `chartRows`): every bar of the
 * chart shares one scale, the largest figure is 108px, any other non-zero figure is at least 4px, and a zero
 * is a 2px stub so the month still reads. A negative figure (refunds above costs) draws as a zero.
 */

/** The tallest bar, px. */
export const CHART_BAR_MAX = 108;
/** The shortest bar for a figure that is not zero, px. */
export const CHART_BAR_MIN = 4;
/** A zero month's stub, px. */
export const CHART_BAR_ZERO = 2;

/** One month of the chart: its short label and its two figures, positive, in minor units. */
export type ChartMonth = { key: string; label: string; incomeMinor: bigint; expenseMinor: bigint };

export type ChartBar = ChartMonth & { incomePx: number; expensePx: number; forecast: boolean };

function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

/** A figure's bar height against the chart's largest figure. */
export function barHeight(value: bigint, largest: bigint): number {
  const shown = positive(value);
  if (shown === 0n) return CHART_BAR_ZERO;
  const scale = largest > 0n ? largest : 1n;
  return Math.max(CHART_BAR_MIN, Math.round((Number(shown) / Number(scale)) * CHART_BAR_MAX));
}

/** The months' bars, oldest first, with the forecast month (when there is one) last. */
export function chartBars(history: readonly ChartMonth[], forecast: ChartMonth | null): ChartBar[] {
  const months = forecast == null ? [...history] : [...history, forecast];
  const largest = months.reduce((most, month) => {
    const top = positive(month.incomeMinor) > positive(month.expenseMinor) ? positive(month.incomeMinor) : positive(month.expenseMinor);
    return top > most ? top : most;
  }, 0n);
  return months.map((month, index) => ({
    ...month,
    incomePx: barHeight(month.incomeMinor, largest),
    expensePx: barHeight(month.expenseMinor, largest),
    forecast: forecast != null && index === months.length - 1,
  }));
}
