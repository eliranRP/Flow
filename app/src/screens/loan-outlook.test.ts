import { describe, expect, it } from "vitest";
import { SAMPLE_AMORTIZING, SAMPLE_BALLOON, SAMPLE_DEMAND, SAMPLE_INTEREST_ONLY, SAMPLE_PAID_OFF } from "../dev/loan-detail-sample";
import type { LoanPayment } from "./loan-detail-data";
import { loanOutlook, paidInPeriod, wholeMinor } from "./loan-outlook";

// FLOW-434: the loan page's next payment, years ahead and paid this year (invented loans).

function pay(docDate: string, interest: bigint, escrow: bigint, principal: bigint, fees = 0n): LoanPayment {
  return { transactionId: docDate, docDate, needsReview: false, interestMinor: interest, escrowMinor: escrow, principalMinor: principal, feesMinor: fees, totalMinor: interest + escrow + principal + fees, parts: fees > 0n ? 4 : 3 };
}

describe("loanOutlook", () => {
  it("starts at the payment due today or later and reads to the last payment", () => {
    const outlook = loanOutlook(SAMPLE_AMORTIZING, "2026-10-09");
    expect(outlook?.next.dueDate).toBe("2026-11-01");
    expect(outlook?.toEnd.payments).toBeGreaterThan(12);
    expect(outlook?.endDate.slice(0, 4)).toBe(outlook?.endYear);
    expect((outlook?.endDate ?? "") >= (outlook?.next.dueDate ?? "~")).toBe(true);
  });

  // FLOW-427 (C20-1): the principal still to pay is the balance in the books, for every kind.
  it.each([
    ["amortizing", SAMPLE_AMORTIZING],
    ["interest only", SAMPLE_INTEREST_ONLY],
    ["balloon", SAMPLE_BALLOON],
  ])("starts the payments left from the balance: %s", (_kind, loan) => {
    const outlook = loanOutlook(loan, "2026-10-09");
    expect(outlook?.toEnd.totals.principal).toBe(loan.balanceMinor);
    // The next payment is the loan's own, outside months of interest only.
    if (loan.kind !== "interest_only") expect(outlook?.next.paymentMinor).toBe(loan.paymentMinor);
  });

  it("keeps the months of interest only still ahead, then amortizes over the rest of the term", () => {
    // A 24-month loan started 2026-03-01 with 12 months of interest only (the sample bridge is now a 6-month note).
    const loan = { ...SAMPLE_INTEREST_ONLY, startDate: "2026-03-01", termMonths: 24, interestOnlyMonths: 12, paymentMinor: 2_115_566n, balanceMinor: 23_000_000n };
    const outlook = loanOutlook(loan, "2026-10-09");
    // Started 2026-03-01 with 12 months of interest only: November to February pay no principal.
    expect(outlook?.next).toMatchObject({ dueDate: "2026-11-01", principalMinor: 0n });
    expect(outlook?.toEnd.totals.principal).toBe(23_000_000n);
    expect(outlook?.endYear).toBe("2028");
    // Past them, a balance above the schedule leaves more for the last payment.
    const later = loanOutlook(loan, "2027-06-09");
    expect(later?.next.principalMinor).toBeGreaterThan(0n);
    expect(later?.toEnd.totals.principal).toBe(23_000_000n);
  });

  it("keeps the balloon at the end of the term", () => {
    const outlook = loanOutlook(SAMPLE_BALLOON, "2026-10-09");
    expect(outlook?.endYear).toBe("2031");
    expect(outlook?.endDate).toBe("2031-06-01");
  });

  it("has none once the balance is paid", () => {
    expect(loanOutlook({ ...SAMPLE_AMORTIZING, balanceMinor: 0n }, "2026-10-09")).toBeNull();
  });

  it("counts the payment due today as next", () => {
    expect(loanOutlook(SAMPLE_AMORTIZING, "2026-11-01")?.next.dueDate).toBe("2026-11-01");
  });

  it("has none for a demand loan or one that ended", () => {
    expect(loanOutlook(SAMPLE_DEMAND, "2026-10-09")).toBeNull();
    expect(loanOutlook(SAMPLE_PAID_OFF, "2026-10-09")).toBeNull();
    // A loan marked paid off or closed while its schedule still runs has no next payment either.
    expect(loanOutlook({ ...SAMPLE_AMORTIZING, status: "paid_off" }, "2026-10-09")).toBeNull();
    expect(loanOutlook({ ...SAMPLE_AMORTIZING, status: "closed" }, "2026-10-09")).toBeNull();
  });
});

describe("paidInPeriod", () => {
  const payments = [pay("2026-01-01", 100n, 50n, 10n), pay("2025-12-01", 999n, 0n, 0n), pay("2026-02-01", 100n, 50n, 12n, 5n)];

  it("adds up the year's attached payments part by part", () => {
    const paid = paidInPeriod(payments, "2026");
    expect(paid).toMatchObject({ payments: 2, totalMinor: 327n, totals: { interest: 200n, escrow: 100n, principal: 22n, fees: 5n } });
  });

  it("adds up every attached payment since the loan started for \"all\"", () => {
    const paid = paidInPeriod(payments, "all");
    expect(paid).toMatchObject({ payments: 3, totalMinor: 1326n, totals: { interest: 1199n, escrow: 100n, principal: 22n, fees: 5n } });
  });
});

describe("labels", () => {
  it("rounds to whole units", () => {
    expect(wholeMinor(12_349n)).toBe(12_300n);
    expect(wholeMinor(12_350n)).toBe(12_400n);
  });
});
