import { describe, expect, it } from "vitest";
import { buildLoanSchedule } from "./loan-schedule.ts";
import { allocateLoanSplit, scheduleRowForDate } from "./loan-split.ts";

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
