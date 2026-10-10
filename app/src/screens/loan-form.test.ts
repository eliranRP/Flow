// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loanFinalLine, type LoanPreview } from "./loan-form";

function ready(pi: bigint, finalPi: bigint): Extract<LoanPreview, { status: "ready" }> {
  return {
    status: "ready",
    kind: "amortizing",
    paymentMinor: pi,
    interestMinor: 0n,
    escrowMinor: 0n,
    balloon: null,
    finalAdjustment: null,
    largeFinalMinor: finalPi,
    insert: {
      name: "הלוואת דוגמה",
      principal_minor: 1,
      annual_rate_ppm: 0,
      term_months: 1,
      start_date: "2026-11-01",
      payment_minor: Number(pi),
      escrow_minor: 0,
      currency: "ILS",
    },
  };
}

describe("loanFinalLine multiple", () => {
  it("floors the ratio to tenths and never shows less than 2.1", () => {
    expect(loanFinalLine(ready(10_000n, 20_200n))?.times).toBe("2.1");
    expect(loanFinalLine(ready(10_000n, 29_300n))?.times).toBe("2.9");
    expect(loanFinalLine(ready(10_000n, 29_500n))?.times).toBe("2.9");
    expect(loanFinalLine(ready(10_000n, 30_000n))?.times).toBe("3");
    expect(loanFinalLine(ready(10_000n, 39_950n))?.times).toBe("3.9");
    expect(loanFinalLine(ready(10_000n, 20_200n))?.times).not.toBe("2");
    expect(loanFinalLine(ready(10_000n, 29_500n))?.times).not.toBe("3");
    expect(loanFinalLine(ready(10_000n, 30_000n))?.times).not.toBe("3.0");
    expect(loanFinalLine(ready(10_000n, 39_950n))?.times).not.toBe("4");
  });

  it("shows 2.1 when the final principal and interest is one cent above twice", () => {
    const line = loanFinalLine(ready(100n, 201n));
    expect(line?.times).toBe("2.1");
    expect(line?.times).not.toBe("2");
    expect(line?.lead).toBe("התשלום האחרון גבוה פי");
  });

  it("keeps an exact double on the כפול line", () => {
    const line = loanFinalLine(ready(100n, 200n));
    expect(line?.lead).toBe("התשלום האחרון כפול");
    expect(line?.times).toBeUndefined();
  });
});
