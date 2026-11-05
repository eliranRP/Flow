import { describe, expect, it } from "vitest";
import type { LoanScheduleRow } from "@flow/shared";
import { SAMPLE_BALLOON, sampleLoanStore } from "../dev/loan-detail-sample";
import { loanBandRows } from "./loan-detail-cards";
import { loanPaymentYears } from "./loan-detail-view-data";
import { loanOutlook } from "./loan-outlook";
import { upcomingPaymentYears } from "./loan-payments-view";

// FLOW-1046: the payments' year groups (paid, newest first; upcoming, soonest first) and the band's rows by kind.

function due(dueDate: string, paymentMinor: bigint): LoanScheduleRow {
  return { period: 1, dueDate, interestMinor: 0n, escrowMinor: 0n, principalMinor: paymentMinor, paymentMinor, balanceMinor: 0n };
}

describe("the payments' year groups", () => {
  it("puts the paid payments in years, newest year and newest date first, with the count and the total", () => {
    const read = sampleLoanStore().read("loan-mortgage");
    if (read.phase !== "ready") throw new Error("no sample");
    const years = loanPaymentYears(read.bundle.payments);
    expect(years.map((year) => [year.year, year.count, year.totalMinor])).toEqual([["2026", 10, 5_240_000n], ["2025", 12, 6_288_000n]]);
    expect(years[0]?.rows[0]?.dateIso.slice(0, 7)).toBe("2026-10");
  });

  it("puts the upcoming payments in years, soonest first, each year's rows in date order", () => {
    const years = upcomingPaymentYears([due("2027-01-20", 300n), due("2026-12-20", 200n), due("2026-11-20", 100n)]);
    expect(years.map((year) => [year.year, year.count, year.totalMinor, year.rows.map((row) => row.dueDate)])).toEqual([
      ["2026", 2, 300n, ["2026-11-20", "2026-12-20"]],
      ["2027", 1, 300n, ["2027-01-20"]],
    ]);
  });

  it("has no group with no payment left", () => {
    expect(upcomingPaymentYears([])).toEqual([]);
  });
});

describe("the loan band's rows by kind", () => {
  const today = "2026-10-09";

  function bundle(id: string) {
    const read = sampleLoanStore().read(id);
    if (read.phase !== "ready") throw new Error("no sample");
    return read.bundle;
  }

  it("draws a regular loan's monthly payment and its rate", () => {
    const { loan, payments } = bundle("loan-mortgage");
    expect(loanBandRows(loan, loanOutlook(loan, today), payments, today).map((row) => [row.label, row.value])).toEqual([["תשלום חודשי", "$5,240"], ["ריבית", "6.25%"]]);
  });

  it("draws an interest-only loan's monthly interest first", () => {
    const { loan, payments } = bundle("loan-bridge");
    expect(loanBandRows(loan, loanOutlook(loan, today), payments, today).map((row) => row.label)).toEqual(["ריבית חודשית", "ריבית"]);
  });

  it("draws a demand loan's rate and what was repaid this year", () => {
    const { loan, payments } = bundle("loan-partner");
    expect(loanBandRows(loan, loanOutlook(loan, today), payments, today).map((row) => row.label)).toEqual(["ריבית", "הוחזר השנה"]);
  });

  it("keeps the rate alone with no schedule left", () => {
    expect(loanBandRows(SAMPLE_BALLOON, null, [], today).map((row) => row.label)).toEqual(["ריבית"]);
  });
});
