import { describe, expect, it } from "vitest";
import { SAMPLE_AMORTIZING, SAMPLE_DEMAND, SAMPLE_LOAN_CATEGORIES, SAMPLE_PAID_OFF } from "../dev/loan-detail-sample";
import type { LoanPayment } from "./loan-detail-data";
import { dueDayLabel, loanOutlook, paidInYear, partCategoryHint, partShares, wholeMinor } from "./loan-outlook";

// FLOW-434: the loan page's next payment, years ahead and paid this year (invented loans).

function pay(docDate: string, interest: bigint, escrow: bigint, principal: bigint, fees = 0n): LoanPayment {
  return { transactionId: docDate, docDate, needsReview: false, interestMinor: interest, escrowMinor: escrow, principalMinor: principal, feesMinor: fees, totalMinor: interest + escrow + principal + fees, parts: fees > 0n ? 4 : 3 };
}

describe("loanOutlook", () => {
  it("starts at the payment due today or later and groups the rest by year", () => {
    const outlook = loanOutlook(SAMPLE_AMORTIZING, "2026-10-09");
    expect(outlook?.next.dueDate).toBe("2026-11-01");
    expect(outlook?.ahead.payments).toBe(12);
    expect(outlook?.years[0]).toMatchObject({ key: "2026", payments: 2 });
    expect(outlook?.years[1]).toMatchObject({ key: "2027", payments: 12 });
    const yearsSum = outlook?.years.reduce((sum, year) => sum + year.totalMinor, 0n);
    expect(yearsSum).toBe(outlook?.toEnd.totalMinor);
    expect(outlook?.toEnd.payments).toBe(outlook?.years.reduce((sum, year) => sum + year.payments, 0));
    expect(outlook?.endYear).toBe("2054");
  });

  it("counts the payment due today as next", () => {
    expect(loanOutlook(SAMPLE_AMORTIZING, "2026-11-01")?.next.dueDate).toBe("2026-11-01");
  });

  it("has none for a demand loan or one that ended", () => {
    expect(loanOutlook(SAMPLE_DEMAND, "2026-10-09")).toBeNull();
    expect(loanOutlook(SAMPLE_PAID_OFF, "2026-10-09")).toBeNull();
  });
});

describe("paidInYear", () => {
  it("adds up the year's attached payments part by part", () => {
    const paid = paidInYear([pay("2026-01-01", 100n, 50n, 10n), pay("2025-12-01", 999n, 0n, 0n), pay("2026-02-01", 100n, 50n, 12n, 5n)], "2026");
    expect(paid).toMatchObject({ payments: 2, totalMinor: 327n, totals: { interest: 200n, escrow: 100n, principal: 22n, fees: 5n } });
  });
});

describe("partShares", () => {
  it("rounds to whole percents that add up to 100", () => {
    const shares = partShares({ interest: 1_126_000n, escrow: 428_000n, principal: 88_000n, fees: 0n }, ["interest", "escrow", "principal", "fees"]);
    expect(shares.map((item) => item.part)).toEqual(["interest", "escrow", "principal"]);
    expect(shares.reduce((sum, item) => sum + item.percent, 0)).toBe(100);
    expect(shares.map((item) => item.percent)).toEqual([69, 26, 5]);
  });

  it("shows fees only when there are any, and 0% on nothing paid", () => {
    expect(partShares({ interest: 1n, escrow: 1n, principal: 1n, fees: 1n }, ["interest", "escrow", "principal", "fees"]).map((item) => item.part)).toContain("fees");
    expect(partShares({ interest: 0n, escrow: 0n, principal: 0n, fees: 0n }, ["interest", "principal"]).map((item) => item.percent)).toEqual([0, 0]);
  });
});

describe("labels", () => {
  it("names the due day in Hebrew", () => {
    expect(dueDayLabel("2026-11-01")).toBe("1 בנובמבר");
  });

  it("drops a category hint that repeats the part's label", () => {
    const loan = { categoryIds: { interest: null, escrow: null, principal: null, fees: null } };
    expect(partCategoryHint(loan, SAMPLE_LOAN_CATEGORIES, "escrow")).toBeNull();
    expect(partCategoryHint(loan, SAMPLE_LOAN_CATEGORIES, "principal")).toBe("תשלומי הלוואה");
    expect(partCategoryHint({ categoryIds: { ...loan.categoryIds, interest: "cat-bridge" } }, SAMPLE_LOAN_CATEGORIES, "interest")).toBe("ריבית הלוואות גישור");
  });

  it("rounds to whole units", () => {
    expect(wholeMinor(12_349n)).toBe(12_300n);
    expect(wholeMinor(12_350n)).toBe(12_400n);
  });
});
