import { describe, expect, it } from "vitest";
import { SAMPLE_AMORTIZING, SAMPLE_BALLOON, SAMPLE_DEMAND, SAMPLE_INTEREST_ONLY, SAMPLE_PAID_OFF } from "../dev/loan-detail-sample";
import { loanOutlook } from "./loan-outlook";
import { loanListSummary, type LoanListEntry } from "./loan-list-summary";

// FLOW-139: the Loans list's summary card. Invented loans from the dev sample.

const TODAY = "2026-10-16";
const USD = "USD";

function entry(loan: (typeof SAMPLE_AMORTIZING), today = TODAY): LoanListEntry {
  return { loan, outlook: loanOutlook(loan, today) };
}

describe("loanListSummary", () => {
  it("counts only open loans and sums their balances", () => {
    const summary = loanListSummary([entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_PAID_OFF), entry(SAMPLE_DEMAND)], USD);
    expect(summary.openCount).toBe(
      [SAMPLE_AMORTIZING, SAMPLE_INTEREST_ONLY, SAMPLE_PAID_OFF, SAMPLE_DEMAND].filter((loan) => loan.status === "open").length,
    );
    const balances = [SAMPLE_AMORTIZING, SAMPLE_INTEREST_ONLY, SAMPLE_PAID_OFF, SAMPLE_DEMAND]
      .filter((loan) => loan.status === "open")
      .reduce((sum, loan) => sum + loan.balanceMinor, 0n);
    expect(summary.totalBalanceMinor).toBe(balances);
  });

  it("sums each open loan's next payment part by part, as the monthly line", () => {
    const entries = [entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY), entry(SAMPLE_BALLOON)];
    const summary = loanListSummary(entries, USD);
    const nexts = entries.map((item) => item.outlook?.next).filter((row) => row != null);
    const sum = (pick: (row: (typeof nexts)[number]) => bigint) => nexts.reduce((total, row) => total + pick(row), 0n);
    expect(summary.monthlyParts.principal).toBe(sum((row) => row.principalMinor));
    expect(summary.monthlyParts.interest).toBe(sum((row) => row.interestMinor));
    expect(summary.monthlyParts.escrow).toBe(sum((row) => row.escrowMinor));
    expect(summary.monthlyMinor).toBe(summary.monthlyParts.principal + summary.monthlyParts.interest + summary.monthlyParts.escrow);
  });

  it("sums the next twelve payments of every open loan", () => {
    const entries = [entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY)];
    const summary = loanListSummary(entries, USD);
    expect(summary.twelveMonthsMinor).toBe(entries.reduce((total, item) => total + (item.outlook?.ahead.totalMinor ?? 0n), 0n));
  });

  it("names the earliest next payment and its loan", () => {
    const entries = [entry(SAMPLE_AMORTIZING), entry(SAMPLE_INTEREST_ONLY)];
    const summary = loanListSummary(entries, USD);
    const dues = entries.map((item) => item.outlook?.next.dueDate).filter((due): due is string => due != null).sort();
    expect(summary.next?.dueDate).toBe(dues[0]);
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
