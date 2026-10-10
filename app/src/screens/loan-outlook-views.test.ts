import { describe, expect, it } from "vitest";
import { aheadLabel, paymentsWord, periodTotal, roundTotals } from "./loan-outlook-views";

// FLOW-434: the rounded parts on screen add up to the rounded total shown above them.

describe("roundTotals", () => {
  it("rounds each part to whole units and gives the leftover unit to the largest remainder", () => {
    const totals = { interest: 1_234_567n, escrow: 345_678n, principal: 98_765n, fees: 0n };
    const rounded = roundTotals(totals);
    expect(rounded).toEqual({ interest: 1_234_600n, escrow: 345_700n, principal: 98_700n, fees: 0n });
    expect(periodTotal(totals)).toBe(1_679_000n);
  });

  it("adds up to the rounded total when every part rounds down", () => {
    // 3 × 0.40 = 1.20: each part alone rounds to 0, the total to 1, and one part carries it.
    const totals = { interest: 40n, escrow: 40n, principal: 40n, fees: 0n };
    expect(periodTotal(totals)).toBe(100n);
    expect(roundTotals(totals)).toEqual({ interest: 100n, escrow: 0n, principal: 0n, fees: 0n });
  });

  it("leaves whole amounts alone", () => {
    const totals = { interest: 500n, escrow: 200n, principal: 300n, fees: 0n };
    expect(roundTotals(totals)).toEqual(totals);
  });
});

describe("labels", () => {
  it("counts payments in Hebrew", () => {
    expect(paymentsWord(1)).toBe("תשלום אחד");
    expect(paymentsWord(2)).toBe("2 תשלומים");
  });

  it("names the months ahead, and the last payments near the end", () => {
    expect(aheadLabel(12)).toBe("12 חודשים");
    expect(aheadLabel(1)).toBe("התשלום האחרון");
    expect(aheadLabel(3)).toBe("3 התשלומים האחרונים");
  });
});
