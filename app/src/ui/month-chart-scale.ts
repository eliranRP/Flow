/**
 * The income and expense chart's bar heights (Profit, Projects and MonthForecast boards, `chartRows`): every
 * bar of the chart shares one scale, the largest figure is 108px, any other non-zero figure is at least 4px,
 * and a zero is a 2px stub so the month still reads. A negative figure (refunds above costs) draws as a zero.
 * A month in progress stacks what is still expected on top of what came in and went out so far: the scale
 * counts the two together, and the dashed cap has no floor.
 */

/** The tallest bar, px. */
export const CHART_BAR_MAX = 108;
/** The shortest bar for a figure that is not zero, px. */
export const CHART_BAR_MIN = 4;
/** A zero month's stub, px. */
export const CHART_BAR_ZERO = 2;

/**
 * One month of the chart: its short label and its two figures, positive, in minor units. `ahead` marks the
 * month in progress: the figures are so far, and `ahead` is what is still expected, drawn as a dashed cap.
 */
export type ChartMonth = {
  key: string;
  label: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  ahead?: { incomeMinor: bigint; expenseMinor: bigint };
};

export type ChartBar = ChartMonth & {
  incomePx: number;
  expensePx: number;
  /** The dashed cap's height over the solid bar; 0 when nothing more is expected. */
  incomeAheadPx: number;
  expenseAheadPx: number;
  /** Next month: both bars dashed and unfilled. */
  forecast: boolean;
  /** The month in progress: solid so far, a dashed cap for what is still expected. */
  inProgress: boolean;
};

function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function scaled(value: bigint, largest: bigint): number {
  const scale = largest > 0n ? largest : 1n;
  return Math.round((Number(value) / Number(scale)) * CHART_BAR_MAX);
}

/** A figure's bar height against the chart's largest figure. */
export function barHeight(value: bigint, largest: bigint): number {
  const shown = positive(value);
  if (shown === 0n) return CHART_BAR_ZERO;
  return Math.max(CHART_BAR_MIN, scaled(shown, largest));
}

/** A still-expected cap's height: on the same scale, with no floor, and nothing when nothing is expected. */
export function capHeight(value: bigint, largest: bigint): number {
  const shown = positive(value);
  return shown === 0n ? 0 : scaled(shown, largest);
}

/** A month's taller column: so far plus still expected, income or expenses. */
function columnTop(month: ChartMonth): bigint {
  const income = positive(month.incomeMinor) + positive(month.ahead?.incomeMinor ?? 0n);
  const expense = positive(month.expenseMinor) + positive(month.ahead?.expenseMinor ?? 0n);
  return income > expense ? income : expense;
}

/**
 * The months' bars, oldest first, with the forecast month (when there is one) last; or, for a year's chart, the
 * months left in the year (decision 0200), each dashed.
 */
export function chartBars(history: readonly ChartMonth[], forecast: ChartMonth | readonly ChartMonth[] | null): ChartBar[] {
  const ahead: readonly ChartMonth[] = forecast == null ? [] : "key" in forecast ? [forecast] : forecast;
  const months = [...history, ...ahead];
  const largest = months.reduce((most, month) => {
    const top = columnTop(month);
    return top > most ? top : most;
  }, 0n);
  return months.map((month, index) => ({
    ...month,
    incomePx: barHeight(month.incomeMinor, largest),
    expensePx: barHeight(month.expenseMinor, largest),
    incomeAheadPx: capHeight(month.ahead?.incomeMinor ?? 0n, largest),
    expenseAheadPx: capHeight(month.ahead?.expenseMinor ?? 0n, largest),
    forecast: index >= history.length,
    inProgress: month.ahead != null,
  }));
}
