import { describe, expect, it } from "vitest";
import { linesSummary } from "../cash-lines-groups";
import { sampleBoardCashLines, sampleBoardCashMonths } from "./cash-sample";

const NOW = new Date(2026, 9, 11, 12);

/** FLOW-366b: the board's month lines add up to the figures Home shows for the same month. */
describe("board cash sample", () => {
  const lines = sampleBoardCashLines("out", NOW);
  const summary = linesSummary(lines, "out");
  const home = sampleBoardCashMonths(NOW).months[0]?.by_currency[0];

  it("has 15 out lines, five of them waiting for approval", () => {
    expect(lines).toHaveLength(15);
    expect(summary.pending).toBe(5);
  });

  it("adds up to Home's out figure", () => {
    expect(summary.total).toBe(4_206_900n);
    expect(home?.out_minor).toBe(summary.total);
  });

  it("leaves out of profit the loan principal and the rehab: $13,757", () => {
    expect(summary.notInProfit).toBe(1_375_700n);
    const outside = lines.filter((row) => row.in_pnl === false).map((row) => row.category_name);
    expect(outside).toEqual(["תשלומי הלוואה", "שיפוץ"]);
  });
});
