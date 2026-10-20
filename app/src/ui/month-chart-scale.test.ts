import { describe, expect, it } from "vitest";
import { barHeight, capHeight, CHART_BAR_MAX, CHART_BAR_MIN, CHART_BAR_ZERO, chartBars, type ChartMonth } from "./month-chart-scale";

function month(key: string, income: bigint, expense: bigint): ChartMonth {
  return { key, label: key, incomeMinor: income, expenseMinor: expense };
}

describe("the month chart's scale (chartRows)", () => {
  it("draws the largest figure at 108px and the rest on the same scale", () => {
    expect(barHeight(630_200n, 630_200n)).toBe(CHART_BAR_MAX);
    expect(barHeight(415_000n, 630_200n)).toBe(71);
    expect(barHeight(186_500n, 630_200n)).toBe(32);
  });

  it("keeps a small figure at 4px and a zero at a 2px stub", () => {
    expect(barHeight(100n, 18_500_000n)).toBe(CHART_BAR_MIN);
    expect(barHeight(0n, 18_500_000n)).toBe(CHART_BAR_ZERO);
    // Refunds above costs draw as nothing spent.
    expect(barHeight(-5_000n, 18_500_000n)).toBe(CHART_BAR_ZERO);
    // A chart of zeros still draws its stubs.
    expect(barHeight(0n, 0n)).toBe(CHART_BAR_ZERO);
  });

  it("puts every bar, the forecast's too, on one scale and marks the forecast last", () => {
    const bars = chartBars([month("2026-09", 415_000n, 174_000n), month("2026-10", 630_200n, 250_640n)], month("2026-11", 415_000n, 186_500n));
    expect(bars.map((bar) => [bar.incomePx, bar.expensePx, bar.forecast])).toEqual([
      [71, 30, false],
      [108, 43, false],
      [71, 32, true],
    ]);
  });

  it("lets a forecast above the history set the scale, and draws no forecast when there is none", () => {
    expect(chartBars([month("2026-10", 100_000n, 0n)], month("2026-11", 0n, 400_000n)).map((bar) => bar.expensePx)).toEqual([2, 108]);
    expect(chartBars([month("2026-10", 100_000n, 50_000n)], null).map((bar) => bar.forecast)).toEqual([false]);
  });

  it("lets a flip's purchase month dominate: the later months fall to the 4px floor, income stays a stub", () => {
    const bars = chartBars([month("2026-07", 0n, 18_500_000n), month("2026-08", 0n, 2_240_000n), month("2026-09", 0n, 300_000n)], month("2026-11", 0n, 1_200_000n));
    expect(bars.map((bar) => bar.expensePx)).toEqual([108, 13, 4, 7]);
    expect(bars.every((bar) => bar.incomePx === CHART_BAR_ZERO)).toBe(true);
  });

  it("stacks the month in progress: solid so far, a dashed cap still expected, both on the one scale (MonthForecast board)", () => {
    const history = [
      month("2026-05", 2_310_000n, 2_740_000n),
      month("2026-06", 3_120_000n, 2_480_000n),
      month("2026-07", 2_860_000n, 2_610_000n),
      month("2026-08", 2_790_000n, 2_930_000n),
      month("2026-09", 1_420_000n, 5_240_000n),
      { ...month("2026-10", 2_487_800n, 4_206_900n), ahead: { incomeMinor: 1_975_000n, expenseMinor: 830_000n } },
    ];
    const bars = chartBars(history, null);
    // September's expenses are the largest column; October's so far plus expected stays under it.
    expect(bars[4]?.expensePx).toBe(CHART_BAR_MAX);
    const october = bars[5];
    expect([october?.incomePx, october?.incomeAheadPx, october?.expensePx, october?.expenseAheadPx]).toEqual([51, 41, 87, 17]);
    expect([october?.inProgress, october?.forecast]).toEqual([true, false]);
    // A finished month has no cap.
    expect([bars[0]?.incomeAheadPx, bars[0]?.expenseAheadPx, bars[0]?.inProgress]).toEqual([0, 0, false]);
  });

  it("lets so far plus still expected set the scale, and draws no cap when nothing more is expected", () => {
    const bars = chartBars([month("2026-09", 200_000n, 0n), { ...month("2026-10", 100_000n, 0n), ahead: { incomeMinor: 300_000n, expenseMinor: 0n } }], null);
    expect([bars[1]?.incomePx, bars[1]?.incomeAheadPx]).toEqual([27, 81]);
    expect(bars[0]?.incomePx).toBe(54);
    expect(bars[1]?.expenseAheadPx).toBe(0);
    expect(capHeight(0n, 400_000n)).toBe(0);
    expect(capHeight(-10n, 400_000n)).toBe(0);
  });

  it("a year's chart: every month left is dashed, after the months so far, on the one scale (FLOW-145)", () => {
    const bars = chartBars([month("2026-09", 100_000n, 50_000n), month("2026-10", 200_000n, 80_000n)], [month("2026-11", 400_000n, 100_000n), month("2026-12", 300_000n, 120_000n)]);
    expect(bars.map((bar) => [bar.key, bar.forecast])).toEqual([["2026-09", false], ["2026-10", false], ["2026-11", true], ["2026-12", true]]);
    expect(bars.map((bar) => bar.incomePx)).toEqual([27, 54, 108, 81]);
  });
});
