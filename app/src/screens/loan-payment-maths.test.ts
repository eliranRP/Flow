import { buildLoanSchedule, type LoanTerms } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { sampleLoans, SAMPLE_AMORTIZING, SAMPLE_INTEREST_ONLY } from "../dev/loan-detail-sample";
import { paymentSplitText, loanPaymentYears, paymentTotals, balanceProgress, balanceProgressText, loanSubtitle, dayMonth } from "./loan-detail-view-data";
import type { LoanPayment } from "./loan-detail-data";
import { loanOutlook } from "./loan-outlook";

// FLOW-139c: the payment maths the loan page and the all-payments page show (invented loans, whole cents).

function pay(docDate: string, interest: bigint, escrow: bigint, principal: bigint, fees = 0n, id = docDate): LoanPayment {
  return {
    transactionId: id,
    docDate,
    needsReview: false,
    interestMinor: interest,
    escrowMinor: escrow,
    principalMinor: principal,
    feesMinor: fees,
    totalMinor: interest + escrow + principal + fees,
    parts: [interest, escrow, principal, fees].filter((minor) => minor !== 0n).length,
  };
}

/** The monthly interest a balance accrues at an annual rate in ppm, rounded half up to the cent. */
function monthlyInterest(balance: bigint, ratePpm: number): bigint {
  return (balance * BigInt(ratePpm) + 6_000_000n) / 12_000_000n;
}

describe("amortization (the shared schedule)", () => {
  it("splits each payment into interest on the balance and principal, and the first row starts from the principal", () => {
    const terms: LoanTerms = {
      principalMinor: 24_000_000n,
      annualRatePpm: 62_500,
      termMonths: 360,
      startDate: "2025-01-01",
      paymentMinor: 524_000n,
      escrowMinor: 36_300n,
      kind: "amortizing",
      interestOnlyMonths: null,
      amortizationMonths: null,
      rates: [],
    };
    const rows = buildLoanSchedule(terms).rows;
    expect(rows[0]).toMatchObject({ interestMinor: monthlyInterest(24_000_000n, 62_500), principalMinor: 487_700n - monthlyInterest(24_000_000n, 62_500) });
    expect(rows[0]?.interestMinor).toBe(125_000n);
    // Every row: the interest is the balance before it at the rate, and the principal plus interest is the payment less escrow.
    let before = 24_000_000n;
    for (const row of rows.slice(0, 12)) {
      expect(row.interestMinor).toBe(monthlyInterest(before, 62_500));
      expect(row.principalMinor + row.interestMinor).toBe(487_700n);
      before -= row.principalMinor;
      expect(row.balanceMinor).toBe(before);
    }
  });
});

describe("interest only (the shared schedule)", () => {
  it("pays interest on the whole principal every month, and no principal until its months end", () => {
    const rows = buildLoanSchedule({
      principalMinor: 20_000_000n,
      annualRatePpm: 105_000,
      termMonths: 24,
      startDate: "2026-03-01",
      paymentMinor: 175_000n,
      escrowMinor: 0n,
      kind: "interest_only",
      interestOnlyMonths: 12,
      amortizationMonths: null,
      rates: [],
    }).rows;
    expect(rows.slice(0, 12).every((row) => row.interestMinor === 175_000n && row.principalMinor === 0n)).toBe(true);
  });
});

describe("the sample mortgage's history", () => {
  it("has one payment a month from 01/2025 to 10/2026, each its interest on the balance before it", () => {
    const payments = sampleLoans().find((item) => item.loan.id === SAMPLE_AMORTIZING.id)?.payments ?? [];
    expect(payments).toHaveLength(22);
    const oldestFirst = [...payments].sort((a, b) => (a.docDate < b.docDate ? -1 : 1));
    let balance = SAMPLE_AMORTIZING.principalMinor;
    for (const payment of oldestFirst) {
      expect(payment.interestMinor).toBe(monthlyInterest(balance, SAMPLE_AMORTIZING.annualRatePpm));
      expect(payment.totalMinor).toBe(524_000n);
      balance -= payment.principalMinor;
    }
    expect(balance).toBe(SAMPLE_AMORTIZING.balanceMinor);
  });

  it("the next payment reads the schedule from the balance in the books", () => {
    const next = loanOutlook(SAMPLE_AMORTIZING, "2026-10-17")?.next;
    expect(next?.dueDate).toBe("2026-11-01");
    expect(next?.interestMinor).toBe(monthlyInterest(SAMPLE_AMORTIZING.balanceMinor, SAMPLE_AMORTIZING.annualRatePpm));
  });

  it("the interest-only sample pays only interest on its last payment", () => {
    const payments = sampleLoans().find((item) => item.loan.id === SAMPLE_INTEREST_ONLY.id)?.payments ?? [];
    expect(payments.every((payment) => payment.principalMinor === 0n)).toBe(true);
  });
});

describe("the all-payments page's totals and years", () => {
  const payments = [
    pay("2026-10-01", 900n, 363n, 3_977n, 0n, "a"),
    pay("2026-09-01", 920n, 363n, 3_957n, 100n, "b"),
    pay("2025-12-01", 950n, 363n, 3_927n, 0n, "c"),
    pay("2026-08-01", 940n, 363n, 3_937n, 0n, "d"),
  ];

  it("adds the parts up to the total, and the years up to the same total", () => {
    const totals = paymentTotals(payments);
    expect(totals.principal + totals.interest + totals.escrow + totals.fees).toBe(totals.total);
    expect(totals.total).toBe(payments.reduce((sum, item) => sum + item.totalMinor, 0n));
    const years = loanPaymentYears(payments);
    expect(years.map((year) => year.year)).toEqual(["2026", "2025"]);
    expect(years.map((year) => year.count)).toEqual([3, 1]);
    expect(years.reduce((sum, year) => sum + year.totalMinor, 0n)).toBe(totals.total);
  });

  it("lists each year's rows newest first, with their dates in dd/mm", () => {
    const [first] = loanPaymentYears(payments);
    expect(first?.rows.map((row) => row.date)).toEqual(["01/10", "01/09", "01/08"]);
    expect(dayMonth("2026-10-01")).toBe("01/10");
  });

  it("writes a split without the principal when there is none, and with the fees when there are some", () => {
    expect(paymentSplitText({ principalMinor: 0n, interestMinor: 21_500_000n, feesMinor: 0n }, "USD")).toBe("ריבית $215,000");
    expect(paymentSplitText({ principalMinor: 3_937_00n, interestMinor: 940_00n, feesMinor: 26_00n }, "USD")).toBe("קרן $3,937 · ריבית $940 · עמלות $26");
  });
});

describe("the loan page's balance and subtitle", () => {
  it("counts the principal paid as the principal less the balance, never below zero", () => {
    expect(balanceProgress({ principalMinor: 24_000_000n, balanceMinor: 15_568_693n })).toEqual({ paidMinor: 8_431_307n, remainingMinor: 15_568_693n });
    expect(balanceProgress({ principalMinor: 1_000n, balanceMinor: 2_000n })).toEqual({ paidMinor: 0n, remainingMinor: 2_000n });
  });

  it("says what is paid of the principal, and the year it runs to", () => {
    const outlook = loanOutlook(SAMPLE_AMORTIZING, "2026-10-17");
    expect(outlook).not.toBeNull();
    if (outlook == null) return;
    expect(balanceProgressText(SAMPLE_AMORTIZING, outlook)).toMatch(/^נפרע \$84,313 מתוך \$240,000 · לתשלום עד \d{4}$/);
    expect(balanceProgressText(SAMPLE_INTEREST_ONLY, { ...outlook, endDate: "2028-03-01" })).toBe("ריבית בלבד: הקרן ($240,000) תיפרע בסוף, 03/2028");
  });

  it("names the project, the kind and the start month, or no project", () => {
    expect(loanSubtitle(SAMPLE_AMORTIZING, "שיפוץ דוגמה 12")).toBe("שיפוץ דוגמה 12 · פריסה רגילה · מאז 01/2025");
    expect(loanSubtitle(SAMPLE_AMORTIZING, null)).toBe("ללא פרויקט · פריסה רגילה · מאז 01/2025");
  });
});
