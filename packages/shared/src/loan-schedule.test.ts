import { describe, expect, it } from "vitest";
import { buildLoanSchedule, type LoanTerms } from "./loan-schedule.ts";

const base: LoanTerms = {
  principalMinor: 10_000_000n,
  annualRatePpm: 60_000,
  termMonths: 360,
  startDate: "2026-02-01",
  paymentMinor: 59_955n,
  escrowMinor: 0n,
};

describe("buildLoanSchedule", () => {
  it("splits the first month of a 6 percent loan into interest and principal", () => {
    const [first] = buildLoanSchedule(base);
    expect(first).toMatchObject({
      period: 1,
      dueDate: "2026-02-01",
      interestMinor: 50_000n,
      escrowMinor: 0n,
      principalMinor: 9_955n,
      paymentMinor: 59_955n,
      balanceMinor: 9_990_045n,
    });
  });

  it("keeps escrow out of the interest math and ends at a zero balance", () => {
    const rows = buildLoanSchedule({ ...base, escrowMinor: 20_000n, paymentMinor: 79_955n });
    expect(rows[0]).toMatchObject({
      interestMinor: 50_000n,
      escrowMinor: 20_000n,
      principalMinor: 9_955n,
      paymentMinor: 79_955n,
    });
    const principal = rows.reduce((sum, row) => sum + row.principalMinor, 0n);
    expect(principal).toBe(base.principalMinor);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
  });

  it("rounds a half-even tie on the monthly interest", () => {
    const [first] = buildLoanSchedule({
      principalMinor: 18_000_000n,
      annualRatePpm: 1,
      termMonths: 2,
      startDate: "2026-01-15",
      paymentMinor: 10_000_000n,
      escrowMinor: 0n,
    });
    expect(first?.interestMinor).toBe(2n);
  });

  it("pays a zero-rate loan down to the last remainder", () => {
    const rows = buildLoanSchedule({
      principalMinor: 1_000n,
      annualRatePpm: 0,
      termMonths: 3,
      startDate: "2026-03-31",
      paymentMinor: 400n,
      escrowMinor: 100n,
    });
    expect(rows.map((row) => row.principalMinor)).toEqual([300n, 300n, 400n]);
    expect(rows.map((row) => row.dueDate)).toEqual(["2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(rows[2]?.paymentMinor).toBe(500n);
    expect(rows[2]?.balanceMinor).toBe(0n);
  });

  it("clamps a January 31 start onto the following February", () => {
    const rows = buildLoanSchedule({
      principalMinor: 200n,
      annualRatePpm: 0,
      termMonths: 2,
      startDate: "2024-01-31",
      paymentMinor: 100n,
      escrowMinor: 0n,
    });
    expect(rows.map((row) => row.dueDate)).toEqual(["2024-01-31", "2024-02-29"]);
  });

  it("stops once an early payment clears the balance", () => {
    const rows = buildLoanSchedule({
      ...base,
      termMonths: 360,
      paymentMinor: 20_000_000n,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.principalMinor).toBe(base.principalMinor);
    expect(rows[0]?.balanceMinor).toBe(0n);
  });

  it("rejects a payment that does not cover interest and escrow", () => {
    expect(() => buildLoanSchedule({ ...base, paymentMinor: 40_000n, escrowMinor: 0n })).toThrow(
      /payment does not cover/,
    );
  });

  it("rejects a term, a rate, an escrow, and a calendar date outside the loan", () => {
    expect(() => buildLoanSchedule({ ...base, termMonths: 0 })).toThrow(/term/);
    expect(() => buildLoanSchedule({ ...base, annualRatePpm: 1_000_001 })).toThrow(/rate/);
    expect(() => buildLoanSchedule({ ...base, escrowMinor: base.paymentMinor })).toThrow(/escrow/);
    expect(() => buildLoanSchedule({ ...base, startDate: "2025-02-29" })).toThrow(/start date/);
  });
});
