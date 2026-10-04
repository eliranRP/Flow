import { describe, expect, it } from "vitest";
import {
  buildLoanSchedule,
  LoanScheduleError,
  type LoanSchedule,
  type LoanTerms,
} from "./loan-schedule.ts";

function codeOf(build: () => LoanSchedule): LoanScheduleError["code"] {
  try {
    build();
  } catch (error) {
    expect(error).toBeInstanceOf(LoanScheduleError);
    return (error as LoanScheduleError).code;
  }
  throw new Error("expected a loan schedule error");
}

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
    const odd = buildLoanSchedule({
      principalMinor: 18_000_000n,
      annualRatePpm: 1,
      termMonths: 2,
      startDate: "2026-01-15",
      paymentMinor: 10_000_000n,
      escrowMinor: 0n,
    });
    expect(odd[0]?.interestMinor).toBe(2n);

    const even = buildLoanSchedule({
      principalMinor: 30_000_000n,
      annualRatePpm: 1,
      termMonths: 2,
      startDate: "2026-01-15",
      paymentMinor: 20_000_000n,
      escrowMinor: 0n,
    });
    expect(even[0]?.interestMinor).toBe(2n);
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
    expect(rows.balloon).toEqual({ amountMinor: 500n, ratioToPayment: 1.25 });
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
    expect(rows.balloon).toBeNull();
  });

  it("holds the 360 month vector for 100,000.00 at 6 percent", () => {
    const rows = buildLoanSchedule(base);
    expect(rows).toHaveLength(360);
    expect(rows[0]?.paymentMinor).toBe(59_955n);
    expect(rows.at(-1)?.paymentMinor).toBe(60_000n);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
    expect(rows.reduce((sum, row) => sum + row.interestMinor, 0n)).toBe(11_583_845n);
    expect(rows.reduce((sum, row) => sum + row.principalMinor, 0n)).toBe(base.principalMinor);
    expect(rows.balloon).toBeNull();

    let previous = base.principalMinor;
    for (const row of rows) {
      expect(row.paymentMinor).toBe(row.interestMinor + row.escrowMinor + row.principalMinor);
      expect(row.balanceMinor).toBe(previous - row.principalMinor);
      expect(row.balanceMinor).toBeLessThanOrEqual(previous);
      previous = row.balanceMinor;
    }
  });

  it("flags a final payment that is materially above the contractual one", () => {
    const rows = buildLoanSchedule({ ...base, paymentMinor: 55_000n });
    expect(rows.at(-1)?.paymentMinor).toBe(5_032_440n);
    expect(rows.balloon).toEqual({
      amountMinor: 5_032_440n,
      ratioToPayment: Number(5_032_440n) / Number(55_000n),
    });
  });

  it("flags a payment equal to the interest on 10,000,000.00 at 6 percent", () => {
    const rows = buildLoanSchedule({
      principalMinor: 1_000_000_000n,
      annualRatePpm: 60_000,
      termMonths: 12,
      startDate: "2026-02-01",
      paymentMinor: 5_000_000n,
      escrowMinor: 0n,
    });
    expect(rows[0]).toMatchObject({
      interestMinor: 5_000_000n,
      principalMinor: 0n,
      paymentMinor: 5_000_000n,
      balanceMinor: 1_000_000_000n,
    });
    expect(rows.at(-1)?.paymentMinor).toBe(1_005_000_000n);
    expect(rows.balloon).toEqual({
      amountMinor: 1_005_000_000n,
      ratioToPayment: 201,
    });
  });

  it("rejects a payment below the interest", () => {
    expect(codeOf(() => buildLoanSchedule({ ...base, paymentMinor: 40_000n, escrowMinor: 0n }))).toBe(
      "payment_below_interest",
    );
  });

  it("rejects a principal, a payment, an escrow, a rate, a term, and a date outside the loan", () => {
    expect(codeOf(() => buildLoanSchedule({ ...base, principalMinor: 0n }))).toBe("principal");
    expect(codeOf(() => buildLoanSchedule({ ...base, principalMinor: -1n }))).toBe("principal");
    expect(codeOf(() => buildLoanSchedule({ ...base, paymentMinor: 0n }))).toBe("payment");
    expect(codeOf(() => buildLoanSchedule({ ...base, paymentMinor: -5n }))).toBe("payment");
    expect(codeOf(() => buildLoanSchedule({ ...base, escrowMinor: -1n }))).toBe("escrow");
    expect(codeOf(() => buildLoanSchedule({ ...base, escrowMinor: base.paymentMinor }))).toBe("escrow");
    expect(codeOf(() => buildLoanSchedule({ ...base, annualRatePpm: Number.NaN }))).toBe("rate");
    expect(codeOf(() => buildLoanSchedule({ ...base, annualRatePpm: 1.5 }))).toBe("rate");
    expect(codeOf(() => buildLoanSchedule({ ...base, annualRatePpm: 1_000_001 }))).toBe("rate");
    expect(codeOf(() => buildLoanSchedule({ ...base, termMonths: Number.NaN }))).toBe("term");
    expect(codeOf(() => buildLoanSchedule({ ...base, termMonths: 1.5 }))).toBe("term");
    expect(codeOf(() => buildLoanSchedule({ ...base, termMonths: 0 }))).toBe("term");
    expect(codeOf(() => buildLoanSchedule({ ...base, termMonths: 601 }))).toBe("term");
    expect(codeOf(() => buildLoanSchedule({ ...base, startDate: "2026/02/01" }))).toBe("start_date");
    expect(codeOf(() => buildLoanSchedule({ ...base, startDate: "2025-02-29" }))).toBe("start_date");
    expect(codeOf(() => buildLoanSchedule({ ...base, startDate: "2026-13-01" }))).toBe("start_date");
  });
});
