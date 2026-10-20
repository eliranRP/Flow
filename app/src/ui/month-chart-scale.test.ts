import { describe, expect, it } from "vitest";
import { barHeight, CHART_BAR_MAX, CHART_BAR_MIN, CHART_BAR_ZERO, chartBars, type ChartMonth } from "./month-chart-scale";

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
});
