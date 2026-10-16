import { describe, expect, it } from "vitest";
import { SAMPLE_AMORTIZING, SAMPLE_BALLOON, SAMPLE_DEMAND, SAMPLE_INTEREST_ONLY, SAMPLE_PAID_OFF } from "../dev/loan-detail-sample";
import { loanOutlook } from "./loan-outlook";
import { loanListSummary, type LoanListEntry } from "./loan-list-summary";

// FLOW-139: the Loans list's summary card. Invented loans from the dev sample; the expected
// figures are the sample set's literal values at TODAY, so a change to the maths shows here.

const TODAY = "2026-10-16";
const USD = "USD";

function entry(loan: (typeof SAMPLE_AMORTIZING), today = TODAY): LoanListEntry {
  return { loan, outlook: loanOutlook(loan, today) };
}

describe("loanListSummary", () => {
  it("counts only open loans and sums their balances", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_PAID_OFF), entry(SAMPLE_DEMAND)], USD);
    expect(summary.openCount).toBe(3);
    expect(summary.totalBalanceMinor).toBe(46_119_859n);
  });

  it("sums each open loan's next payment part by part, as the monthly line", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)], USD);
    expect(summary.monthlyParts).toEqual({ principal: 39_847n, interest: 368_270n, escrow: 31_330n });
    expect(summary.monthlyMinor).toBe(439_447n);
  });

  it("sums the next twelve payments of every open loan", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)], USD);
    expect(summary.twelveMonthsMinor).toBe(20_465_044n);
  });

  it("names the earliest next payment and its loan", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)], USD);
    expect(summary.next).toEqual({ loanId: "loan-mortgage", lenderName: "משכנתא דוגמה", dueDate: "2026-11-01", amountMinor: 151_240n });
  });

  it("returns no next payment when no open loan has an outlook", () => {
    const summary = loanListSummary([entry(SAMPLE_PAID_OFF), entry(SAMPLE_DEMAND)], USD);
    expect(summary.next).toBeNull();
    expect(summary.monthlyMinor).toBe(0n);
    expect(summary.twelveMonthsMinor).toBe(0n);
  });

  it("leaves out a loan in another currency, since those amounts do not add", () => {
    const ils = { ...SAMPLE_AMORTIZING, currency: "ILS" as const };
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(ils)], USD);
    expect(summary.openCount).toBe(1);
    expect(summary.totalBalanceMinor).toBe(SAMPLE_AMORTIZING.balanceMinor);
  });
});
