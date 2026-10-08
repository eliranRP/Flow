import { describe, expect, it } from "vitest";
import { buildLoanSchedule } from "./loan-schedule.ts";
import {
  allocateLoanSplit,
  allocateLoanSplitWithFees,
  firstUnpaidRowIndex,
  loanTakesPaymentOn,
  scheduleRowForDate,
  sumScheduleRows,
} from "./loan-split.ts";

describe("allocateLoanSplit", () => {
  it("keeps the schedule when the line matches", () => {
    const parts = allocateLoanSplit({
      lineMinor: 1_000n,
      interestMinor: 500n,
      escrowMinor: 200n,
      principalMinor: 300n,
    });
    expect(parts).toEqual([
      { part: "interest", amountMinor: 500n, scheduledMinor: 500n },
      { part: "escrow", amountMinor: 200n, scheduledMinor: 200n },
      { part: "principal", amountMinor: 300n, scheduledMinor: 300n },
    ]);
  });

  it("lets principal absorb a larger line", () => {
    const parts = allocateLoanSplit({
      lineMinor: 1_200n,
      interestMinor: 500n,
      escrowMinor: 200n,
      principalMinor: 300n,
    });
    expect(parts.map((part) => part.amountMinor)).toEqual([500n, 200n, 500n]);
    expect(parts[2]?.scheduledMinor).toBe(300n);
  });

  it("lets principal absorb a smaller line that still covers interest and escrow", () => {
    const parts = allocateLoanSplit({
      lineMinor: 800n,
      interestMinor: 500n,
      escrowMinor: 200n,
      principalMinor: 300n,
    });
    expect(parts.map((part) => part.amountMinor)).toEqual([500n, 200n, 100n]);
  });

  it("takes a short line out of escrow and then interest", () => {
    const fromEscrow = allocateLoanSplit({
      lineMinor: 600n,
      interestMinor: 500n,
      escrowMinor: 200n,
      principalMinor: 300n,
    });
    expect(fromEscrow.map((part) => part.amountMinor)).toEqual([500n, 100n, 0n]);

    const fromInterest = allocateLoanSplit({
      lineMinor: 400n,
      interestMinor: 500n,
      escrowMinor: 200n,
      principalMinor: 300n,
    });
    expect(fromInterest.map((part) => part.amountMinor)).toEqual([400n, 0n, 0n]);
    expect(fromInterest.reduce((sum, part) => sum + part.amountMinor, 0n)).toBe(400n);
  });

  it("refuses a negative line", () => {
    expect(() => allocateLoanSplit({
      lineMinor: -1n,
      interestMinor: 0n,
      escrowMinor: 0n,
      principalMinor: 0n,
    })).toThrow(/line/);
  });
});

describe("scheduleRowForDate", () => {
  const { rows } = buildLoanSchedule({
    principalMinor: 1_000n,
    annualRatePpm: 0,
    termMonths: 3,
    startDate: "2026-03-31",
    paymentMinor: 400n,
    escrowMinor: 100n,
  });

  it("uses the exact due date, then the month, then the latest earlier row", () => {
    expect(scheduleRowForDate(rows, "2026-03-31")?.period).toBe(1);
    expect(scheduleRowForDate(rows, "2026-03-01")?.period).toBe(1);
    expect(scheduleRowForDate(rows, "2026-04-15")?.dueDate).toBe("2026-04-30");
    expect(scheduleRowForDate(rows, "2026-06-01")?.dueDate).toBe("2026-05-31");
    expect(scheduleRowForDate(rows, "2026-02-01")).toBeNull();
  });
});

describe("loanTakesPaymentOn", () => {
  it("lets an open loan take any date", () => {
    expect(loanTakesPaymentOn({ status: "open", closedOn: null }, "2030-01-01")).toBe(true);
  });

  it("reads a missing status as open", () => {
    expect(loanTakesPaymentOn({}, "2030-01-01")).toBe(true);
  });

  it("lets a paid-off loan take a payment on or before closed_on", () => {
    const loan = { status: "paid_off", closedOn: "2026-02-01" } as const;
    expect(loanTakesPaymentOn(loan, "2026-01-31")).toBe(true);
    expect(loanTakesPaymentOn(loan, "2026-02-01")).toBe(true);
  });

  it("refuses a payment the day after closed_on", () => {
    expect(loanTakesPaymentOn({ status: "closed", closedOn: "2026-02-01" }, "2026-02-02")).toBe(false);
  });

  it("refuses a closed loan with no date", () => {
    expect(loanTakesPaymentOn({ status: "closed", closedOn: null }, "2026-01-01")).toBe(false);
  });
});

describe("allocateLoanSplitWithFees", () => {
  const scheduled = { interestMinor: 500n, escrowMinor: 200n, principalMinor: 300n };

  it("takes the fees off the line first and adds them as a fourth part", () => {
    const parts = allocateLoanSplitWithFees({ lineMinor: 1_250n, feesMinor: 250n, ...scheduled });
    expect(parts).toEqual([
      { part: "interest", amountMinor: 500n, scheduledMinor: 500n },
      { part: "escrow", amountMinor: 200n, scheduledMinor: 200n },
      { part: "principal", amountMinor: 300n, scheduledMinor: 300n },
      { part: "fees", amountMinor: 250n, scheduledMinor: 250n },
    ]);
  });

  it("splits what is left after the fees like allocateLoanSplit", () => {
    const parts = allocateLoanSplitWithFees({ lineMinor: 900n, feesMinor: 400n, ...scheduled });
    expect(parts?.map((part) => [part.part, part.amountMinor])).toEqual([
      ["interest", 500n],
      ["escrow", 0n],
      ["principal", 0n],
      ["fees", 400n],
    ]);
    expect(parts?.reduce((sum, part) => sum + part.amountMinor, 0n)).toBe(900n);
  });

  it("gives the three parts alone when the fees are zero", () => {
    const parts = allocateLoanSplitWithFees({ lineMinor: 1_000n, feesMinor: 0n, ...scheduled });
    expect(parts?.map((part) => part.part)).toEqual(["interest", "escrow", "principal"]);
  });

  it("takes a line equal to the fees, with nothing left for the other parts", () => {
    const parts = allocateLoanSplitWithFees({ lineMinor: 250n, feesMinor: 250n, ...scheduled });
    expect(parts?.map((part) => part.amountMinor)).toEqual([0n, 0n, 0n, 250n]);
  });

  it("takes a 1-cent fee as its own part", () => {
    const parts = allocateLoanSplitWithFees({ lineMinor: 1_001n, feesMinor: 1n, ...scheduled });
    expect(parts?.map((part) => [part.part, part.amountMinor, part.scheduledMinor])).toEqual([
      ["interest", 500n, 500n],
      ["escrow", 200n, 200n],
      ["principal", 300n, 300n],
      ["fees", 1n, 1n],
    ]);
    expect(allocateLoanSplitWithFees({ lineMinor: 0n, feesMinor: 1n, ...scheduled })).toBeNull();
  });

  it("refuses a line smaller than the fees", () => {
    expect(allocateLoanSplitWithFees({ lineMinor: 249n, feesMinor: 250n, ...scheduled })).toBeNull();
  });

  it("rejects negative fees", () => {
    expect(() => allocateLoanSplitWithFees({ lineMinor: 1_000n, feesMinor: -1n, ...scheduled })).toThrow("fees");
  });
});

describe("sumScheduleRows and firstUnpaidRowIndex", () => {
  // 1,000.00 at 0% over 3 months, 300.00 principal a month and 1.00 escrow: rows of 300, 300, 400.
  const { rows } = buildLoanSchedule({
    principalMinor: 100_000n,
    annualRatePpm: 0,
    termMonths: 3,
    startDate: "2026-01-01",
    paymentMinor: 30_100n,
    escrowMinor: 100n,
  });

  it("adds consecutive rows from a start index", () => {
    expect(sumScheduleRows(rows, 0, 2)).toEqual({ interestMinor: 0n, escrowMinor: 200n, principalMinor: 60_000n });
    expect(sumScheduleRows(rows, 1, 2)).toEqual({ interestMinor: 0n, escrowMinor: 200n, principalMinor: 70_000n });
    expect(sumScheduleRows(rows, 2, 1)).toEqual({ interestMinor: 0n, escrowMinor: 100n, principalMinor: 40_000n });
  });

  it("returns null when the rows run past the schedule or the count is not positive", () => {
    expect(sumScheduleRows(rows, 2, 2)).toBeNull();
    expect(sumScheduleRows(rows, 0, 0)).toBeNull();
    expect(sumScheduleRows(rows, -1, 1)).toBeNull();
  });

  it("adds interest too", () => {
    const withInterest = buildLoanSchedule({
      principalMinor: 10_000_000n,
      annualRatePpm: 60_000,
      termMonths: 360,
      startDate: "2026-01-01",
      paymentMinor: 100_000n,
      escrowMinor: 10_000n,
    }).rows;
    const sum = sumScheduleRows(withInterest, 0, 2);
    expect(sum?.interestMinor).toBe((withInterest[0]?.interestMinor ?? 0n) + (withInterest[1]?.interestMinor ?? 0n));
    expect(sum?.escrowMinor).toBe(20_000n);
  });

  it("finds the first row whose scheduled principal through it is more than what was paid", () => {
    expect(firstUnpaidRowIndex(rows, 0n)).toBe(0);
    expect(firstUnpaidRowIndex(rows, 29_999n)).toBe(0);
    expect(firstUnpaidRowIndex(rows, 30_000n)).toBe(1);
    expect(firstUnpaidRowIndex(rows, 60_000n)).toBe(2);
    expect(firstUnpaidRowIndex(rows, 99_999n)).toBe(2);
  });

  it("returns -1 when every row is paid", () => {
    expect(firstUnpaidRowIndex(rows, 100_000n)).toBe(-1);
  });
});
