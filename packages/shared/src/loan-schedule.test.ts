import { describe, expect, it } from "vitest";
import { divHalfEven } from "./money.ts";
import {
  buildLoanSchedule,
  contractualPaymentMinor,
  demandAccrual,
  demandStatement,
  impliedAmortizationMonths,
  LoanScheduleError,
  rateOnDate,
  regularPaymentMinor,
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
    const { rows } = buildLoanSchedule(base);
    const first = rows[0];
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
    const { rows } = buildLoanSchedule({ ...base, escrowMinor: 20_000n, paymentMinor: 79_955n });
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
    expect(odd.rows[0]?.interestMinor).toBe(2n);

    const even = buildLoanSchedule({
      principalMinor: 30_000_000n,
      annualRatePpm: 1,
      termMonths: 2,
      startDate: "2026-01-15",
      paymentMinor: 20_000_000n,
      escrowMinor: 0n,
    });
    expect(even.rows[0]?.interestMinor).toBe(2n);
  });

  it("pays a zero-rate loan down to the last remainder", () => {
    const { rows, balloon } = buildLoanSchedule({
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
    expect(balloon).toEqual({ amountMinor: 500n, ratioToPayment: 1.25 });
  });

  it("clamps a January 31 start onto the following February", () => {
    const { rows } = buildLoanSchedule({
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
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({
      ...base,
      termMonths: 360,
      paymentMinor: 20_000_000n,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.principalMinor).toBe(base.principalMinor);
    expect(rows[0]?.balanceMinor).toBe(0n);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toBeNull();
  });

  it("holds the 360 month vector for 100,000.00 at 6 percent", () => {
    const { rows, balloon, finalAdjustment } = buildLoanSchedule(base);
    expect(rows).toHaveLength(360);
    expect(rows[0]?.paymentMinor).toBe(59_955n);
    expect(rows.at(-1)?.paymentMinor).toBe(60_000n);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
    expect(rows.reduce((sum, row) => sum + row.interestMinor, 0n)).toBe(11_583_845n);
    expect(rows.reduce((sum, row) => sum + row.principalMinor, 0n)).toBe(base.principalMinor);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toEqual({ amountMinor: 60_000n });

    let previous = base.principalMinor;
    for (const row of rows) {
      expect(row.paymentMinor).toBe(row.interestMinor + row.escrowMinor + row.principalMinor);
      expect(row.balanceMinor).toBe(previous - row.principalMinor);
      expect(row.balanceMinor).toBeLessThanOrEqual(previous);
      previous = row.balanceMinor;
    }
  });

  it("does not treat 600.00 against a 599.55 payment as a balloon", () => {
    const { rows, balloon } = buildLoanSchedule(base);
    expect(rows[0]?.paymentMinor).toBe(59_955n);
    expect(rows.at(-1)?.paymentMinor).toBe(60_000n);
    expect(balloon).toBeNull();
  });

  it("stays quiet at 254.71 and flags 254.70 on 26,319.35 at 112,042 ppm", () => {
    const quiet = buildLoanSchedule({
      principalMinor: 2_631_935n,
      annualRatePpm: 112_042,
      termMonths: 360,
      startDate: "2026-01-01",
      paymentMinor: 25_471n,
      escrowMinor: 0n,
    });
    expect(quiet.rows).toHaveLength(360);
    expect(quiet.rows.at(-1)?.balanceMinor).toBe(0n);
    expect(quiet.balloon).toBeNull();
    expect(quiet.finalAdjustment).toEqual({ amountMinor: 26_905n });

    const flagged = buildLoanSchedule({
      principalMinor: 2_631_935n,
      annualRatePpm: 112_042,
      termMonths: 360,
      startDate: "2026-01-01",
      paymentMinor: 25_470n,
      escrowMinor: 0n,
    });
    expect(flagged.balloon).toEqual({
      amountMinor: 29_858n,
      ratioToPayment: Number(29_858n) / Number(25_470n),
    });
    expect(flagged.finalAdjustment).toBeNull();
  });

  it("still flags 550.00, which is more than one cent below the annuity", () => {
    const { rows, balloon } = buildLoanSchedule({ ...base, paymentMinor: 55_000n });
    expect(rows.at(-1)?.paymentMinor).toBe(5_032_440n);
    expect(balloon).toEqual({
      amountMinor: 5_032_440n,
      ratioToPayment: Number(5_032_440n) / Number(55_000n),
    });
  });

  it("does not let a large escrow hide a principal-and-interest shortfall", () => {
    const { balloon } = buildLoanSchedule({
      ...base,
      paymentMinor: 1_055_000n,
      escrowMinor: 1_000_000n,
    });
    expect(balloon).toEqual({
      amountMinor: 6_032_440n,
      ratioToPayment: Number(6_032_440n) / Number(1_055_000n),
    });
  });

  it("stays quiet exactly one cent below the annuity and flags the next cent", () => {
    const level = {
      annualRatePpm: 0,
      termMonths: 3,
      startDate: "2026-01-01",
      paymentMinor: 100n,
      escrowMinor: 0n,
    };
    expect(buildLoanSchedule({ ...level, principalMinor: 303n }).balloon).toBeNull();
    expect(buildLoanSchedule({ ...level, principalMinor: 304n }).balloon).toEqual({
      amountMinor: 104n,
      ratioToPayment: 1.04,
    });
  });

  it("flags a payment equal to the interest on 10,000,000.00 at 6 percent", () => {
    const { rows, balloon } = buildLoanSchedule({
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
    expect(balloon).toEqual({
      amountMinor: 1_005_000_000n,
      ratioToPayment: 201,
    });
  });

  it("rounds the exact annuity half to even", () => {
    expect(contractualPaymentMinor({
      principalMinor: 10_000_000n,
      annualRatePpm: 60_000,
      termMonths: 360,
    })).toBe(59_955n);
    expect(contractualPaymentMinor({
      principalMinor: 1_000n,
      annualRatePpm: 0,
      termMonths: 3,
    })).toBe(333n);
    expect(contractualPaymentMinor({
      principalMinor: 300n,
      annualRatePpm: 0,
      termMonths: 3,
    })).toBe(100n);
  });

  it("rounds a half up to the even minor unit instead of down", () => {
    expect(contractualPaymentMinor({
      principalMinor: 7n,
      annualRatePpm: 0,
      termMonths: 2,
    })).toBe(4n);
  });

  it("rounds a half down to the even minor unit", () => {
    expect(contractualPaymentMinor({
      principalMinor: 5n,
      annualRatePpm: 0,
      termMonths: 2,
    })).toBe(2n);
  });

  it("leaves an early payoff inside the rounding band off the adjusted final", () => {
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({
      principalMinor: 8n,
      annualRatePpm: 0,
      termMonths: 4,
      startDate: "2026-01-01",
      paymentMinor: 3n,
      escrowMinor: 0n,
    });
    expect(rows.map((row) => row.paymentMinor)).toEqual([3n, 3n, 2n]);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toBeNull();
  });

  it("leaves a full term outside the one cent band off the adjusted final", () => {
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({
      principalMinor: 100n,
      annualRatePpm: 0,
      termMonths: 4,
      startDate: "2026-01-01",
      paymentMinor: 30n,
      escrowMinor: 0n,
    });
    expect(rows.map((row) => row.paymentMinor)).toEqual([30n, 30n, 30n, 10n]);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toBeNull();
  });

  it("keeps a 600 month final payment of twice the regular one off the balloon", () => {
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({
      principalMinor: 360_600n,
      annualRatePpm: 0,
      termMonths: 600,
      startDate: "2026-01-01",
      paymentMinor: 600n,
      escrowMinor: 0n,
    });
    expect(rows).toHaveLength(600);
    expect(rows.at(-1)?.paymentMinor).toBe(1_200n);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toEqual({ amountMinor: 1_200n });
  });

  it("keeps a rounding-only final payment that is more than twice the principal and interest", () => {
    const paymentMinor = contractualPaymentMinor({
      principalMinor: 3_491_009n,
      annualRatePpm: 298_000,
      termMonths: 480,
    });
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({
      principalMinor: 3_491_009n,
      annualRatePpm: 298_000,
      termMonths: 480,
      startDate: "2026-01-01",
      paymentMinor,
      escrowMinor: 0n,
    });
    expect(paymentMinor).toBe(86_694n);
    expect(rows).toHaveLength(480);
    expect(rows.at(-1)?.paymentMinor).toBe(254_165n);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toEqual({ amountMinor: 254_165n });
    const pi = paymentMinor;
    expect((rows.at(-1)?.paymentMinor ?? 0n) > pi * 2n).toBe(true);
  });

  it("rejects a negative rate", () => {
    expect(codeOf(() => buildLoanSchedule({ ...base, annualRatePpm: -1 }))).toBe("rate");
  });

  it("keeps principal and a zero ending balance across several loans", () => {
    const loans: LoanTerms[] = [
      base,
      { ...base, escrowMinor: 20_000n, paymentMinor: 79_955n },
      { ...base, paymentMinor: 55_000n },
      { ...base, paymentMinor: 20_000_000n },
      {
        principalMinor: 2_631_935n,
        annualRatePpm: 112_042,
        termMonths: 360,
        startDate: "2026-01-01",
        paymentMinor: 25_471n,
        escrowMinor: 0n,
      },
      {
        principalMinor: 1_000n,
        annualRatePpm: 0,
        termMonths: 3,
        startDate: "2026-03-31",
        paymentMinor: 400n,
        escrowMinor: 100n,
      },
      {
        principalMinor: 1_000_000_000n,
        annualRatePpm: 60_000,
        termMonths: 12,
        startDate: "2026-02-01",
        paymentMinor: 5_000_000n,
        escrowMinor: 0n,
      },
      {
        principalMinor: 304n,
        annualRatePpm: 0,
        termMonths: 3,
        startDate: "2026-01-01",
        paymentMinor: 100n,
        escrowMinor: 0n,
      },
    ];
    for (const terms of loans) {
      const { rows } = buildLoanSchedule(terms);
      const principal = rows.reduce((sum, row) => sum + row.principalMinor, 0n);
      expect(principal).toBe(terms.principalMinor);
      expect(rows.at(-1)?.balanceMinor).toBe(0n);
      let previous = terms.principalMinor;
      for (const [index, row] of rows.entries()) {
        expect(row.period).toBe(index + 1);
        expect(row.interestMinor).toBe(divHalfEven(previous * BigInt(terms.annualRatePpm), 12_000_000n));
        expect(row.escrowMinor).toBe(terms.escrowMinor);
        expect(row.principalMinor).toBeGreaterThanOrEqual(0n);
        expect(row.paymentMinor).toBe(row.interestMinor + row.escrowMinor + row.principalMinor);
        expect(row.balanceMinor).toBe(previous - row.principalMinor);
        expect(row.balanceMinor).toBeGreaterThanOrEqual(0n);
        const last = index === rows.length - 1;
        if (!last) expect(row.paymentMinor).toBe(terms.paymentMinor);
        previous = row.balanceMinor;
      }
    }
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

describe("loan kinds and rate changes (decision 0132)", () => {
  // 120,000.00 at 6 percent: 600.00 interest a month on the full balance.
  const io: LoanTerms = {
    principalMinor: 12_000_000n,
    annualRatePpm: 60_000,
    termMonths: 24,
    startDate: "2026-01-01",
    paymentMinor: 0n,
    escrowMinor: 10_000n,
    kind: "interest_only",
    interestOnlyMonths: 12,
  };

  it("an amortizing loan without kind fields or rate rows keeps its schedule exactly", () => {
    const plain = buildLoanSchedule(base);
    expect(buildLoanSchedule({ ...base, kind: "amortizing", rates: [] })).toEqual(plain);
    expect(buildLoanSchedule({ ...base, interestOnlyMonths: null, amortizationMonths: null })).toEqual(plain);
  });

  it("interest-only: the last interest-only month pays interest and escrow, the next one starts amortizing", () => {
    const paymentMinor = regularPaymentMinor({ ...io, kind: "interest_only" });
    expect(paymentMinor).toBe(contractualPaymentMinor({ principalMinor: 12_000_000n, annualRatePpm: 60_000, termMonths: 12 }) + 10_000n);
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({ ...io, paymentMinor });
    expect(rows).toHaveLength(24);
    const lastIo = rows[11];
    expect(lastIo?.dueDate).toBe("2026-12-01");
    expect(lastIo?.interestMinor).toBe(60_000n);
    expect(lastIo?.principalMinor).toBe(0n);
    expect(lastIo?.paymentMinor).toBe(70_000n);
    expect(lastIo?.balanceMinor).toBe(12_000_000n);
    const first = rows[12];
    expect(first?.interestMinor).toBe(60_000n);
    expect(first?.paymentMinor).toBe(paymentMinor);
    expect(first?.principalMinor).toBe(paymentMinor - 10_000n - 60_000n);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
    expect(balloon).toBeNull();
    expect(finalAdjustment).toBeNull();
  });

  it("interest-only for the whole term: the principal is due in the last month", () => {
    const whole = { ...io, interestOnlyMonths: 24 };
    const paymentMinor = regularPaymentMinor(whole);
    // One month of amortizing is the bullet: principal plus a month's interest, plus escrow.
    expect(paymentMinor).toBe(12_000_000n + 60_000n + 10_000n);
    const { rows, balloon } = buildLoanSchedule({ ...whole, paymentMinor });
    expect(rows[22]?.principalMinor).toBe(0n);
    expect(rows[23]?.principalMinor).toBe(12_000_000n);
    expect(rows[23]?.paymentMinor).toBe(12_070_000n);
    expect(balloon?.amountMinor).toBe(12_070_000n);
  });

  it("refuses interest-only months outside 1 to the term, and kind fields on the wrong kind", () => {
    expect(codeOf(() => buildLoanSchedule({ ...io, paymentMinor: 100_000n, interestOnlyMonths: 0 }))).toBe("interest_only_months");
    expect(codeOf(() => buildLoanSchedule({ ...io, paymentMinor: 100_000n, interestOnlyMonths: 25 }))).toBe("interest_only_months");
    expect(codeOf(() => buildLoanSchedule({ ...io, paymentMinor: 100_000n, interestOnlyMonths: null }))).toBe("interest_only_months");
    expect(codeOf(() => buildLoanSchedule({ ...base, interestOnlyMonths: 3 }))).toBe("interest_only_months");
    expect(codeOf(() => buildLoanSchedule({ ...base, amortizationMonths: 400 }))).toBe("amortization_months");
    expect(codeOf(() => buildLoanSchedule({ ...base, kind: "demand" }))).toBe("kind");
  });

  it("balloon: the annuity over the amortization months, and the rest of the balance at the term", () => {
    const terms: LoanTerms = { ...base, termMonths: 60, kind: "balloon", amortizationMonths: 360 };
    const paymentMinor = regularPaymentMinor(terms);
    expect(paymentMinor).toBe(59_955n);
    const { rows, balloon, finalAdjustment } = buildLoanSchedule({ ...terms, paymentMinor });
    expect(rows).toHaveLength(60);
    const before = rows[58];
    const last = rows[59];
    expect(before?.paymentMinor).toBe(59_955n);
    expect(last?.dueDate).toBe("2031-01-01");
    expect(last?.principalMinor).toBe(before?.balanceMinor);
    expect(last?.balanceMinor).toBe(0n);
    expect(last?.paymentMinor).toBe((last?.interestMinor ?? 0n) + (before?.balanceMinor ?? 0n));
    expect(balloon?.amountMinor).toBe(last?.paymentMinor);
    expect(finalAdjustment).toBeNull();
    // The months before the balloon match an amortizing loan over 360 months.
    expect(rows.slice(0, 59)).toEqual(buildLoanSchedule(base).rows.slice(0, 59));
  });

  it("refuses amortization months below the term or above 600", () => {
    const terms: LoanTerms = { ...base, termMonths: 60, kind: "balloon" };
    expect(codeOf(() => buildLoanSchedule({ ...terms, amortizationMonths: 59 }))).toBe("amortization_months");
    expect(codeOf(() => buildLoanSchedule({ ...terms, amortizationMonths: 601 }))).toBe("amortization_months");
    expect(() => regularPaymentMinor({ ...terms, amortizationMonths: null })).toThrow("amortization_months");
  });

  it("a rate change mid-schedule recasts the payment over the months left", () => {
    const rates = [{ effectiveDate: "2027-02-01", annualRatePpm: 120_000 }];
    const plain = buildLoanSchedule(base).rows;
    const { rows, finalAdjustment } = buildLoanSchedule({ ...base, rates });
    // Before the change: the same rows.
    expect(rows.slice(0, 12)).toEqual(plain.slice(0, 12));
    const before = rows[11];
    const changed = rows[12];
    expect(changed?.dueDate).toBe("2027-02-01");
    const balance = before?.balanceMinor ?? 0n;
    expect(changed?.interestMinor).toBe(divHalfEven(balance * 120_000n, 12_000_000n));
    const recast = contractualPaymentMinor({ principalMinor: balance, annualRatePpm: 120_000, termMonths: 348 });
    expect(changed?.paymentMinor).toBe(recast);
    expect(rows[13]?.paymentMinor).toBe(recast);
    expect(rows).toHaveLength(360);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
    expect(finalAdjustment).toBeNull();
  });

  it("a rate row on the loan's own rate changes nothing, and the rate in force is the latest on or before the date", () => {
    expect(buildLoanSchedule({ ...base, rates: [{ effectiveDate: "2026-06-01", annualRatePpm: 60_000 }] }).rows)
      .toEqual(buildLoanSchedule(base).rows);
    const rates = [{ effectiveDate: "2026-03-01", annualRatePpm: 70_000 }, { effectiveDate: "2026-05-01", annualRatePpm: 80_000 }];
    expect(rateOnDate(60_000, rates, "2026-02-28")).toBe(60_000);
    expect(rateOnDate(60_000, rates, "2026-03-01")).toBe(70_000);
    expect(rateOnDate(60_000, rates, "2026-12-01")).toBe(80_000);
  });

  it("a rate change during the interest-only months moves the interest, and the payment after them is recast", () => {
    const paymentMinor = regularPaymentMinor(io);
    const rates = [{ effectiveDate: "2026-07-01", annualRatePpm: 120_000 }];
    const { rows } = buildLoanSchedule({ ...io, paymentMinor, rates });
    expect(rows[5]?.interestMinor).toBe(60_000n);
    expect(rows[6]?.interestMinor).toBe(120_000n);
    expect(rows[6]?.principalMinor).toBe(0n);
    const recast = contractualPaymentMinor({ principalMinor: 12_000_000n, annualRatePpm: 120_000, termMonths: 12 });
    expect(rows[12]?.paymentMinor).toBe(recast + 10_000n);
    expect(rows.at(-1)?.balanceMinor).toBe(0n);
  });

  it("a rate change on an amortizing loan with an implicit balloon recasts over the period its payment implies", () => {
    // 100,000.00 at 6% for 60 months, with the payment of a 360-month annuity (599.55).
    const terms: LoanTerms = { ...base, termMonths: 60, paymentMinor: 59_955n };
    expect(impliedAmortizationMonths(terms)).toBe(360);
    // A payment that covers the term annuity implies the term.
    expect(impliedAmortizationMonths(base)).toBe(360);
    const plain = buildLoanSchedule(terms);
    expect(plain.balloon).not.toBeNull();
    // 6.5% from month 6 (2026-07-01).
    const rates = [{ effectiveDate: "2026-07-01", annualRatePpm: 65_000 }];
    const { rows, balloon } = buildLoanSchedule({ ...terms, rates });
    expect(rows.slice(0, 5)).toEqual(plain.rows.slice(0, 5));
    const balance = rows[4]?.balanceMinor ?? 0n;
    const recast = contractualPaymentMinor({ principalMinor: balance, annualRatePpm: 65_000, termMonths: 355 });
    expect(rows[5]?.paymentMinor).toBe(recast);
    expect(rows[58]?.paymentMinor).toBe(recast);
    // The payment moves a little, not about 3.5 times as over the 55 months left in the term.
    expect(recast > 59_955n && recast < 65_000n).toBe(true);
    // The balloon stays at the term.
    expect(rows).toHaveLength(60);
    expect(rows[59]?.balanceMinor).toBe(0n);
    expect(balloon?.amountMinor).toBe(rows[59]?.paymentMinor);
    expect((balloon?.amountMinor ?? 0n) > 9_000_000n).toBe(true);
    // Below the 600-month annuity (but above the interest) the period is capped at 600.
    const thin = { ...terms, paymentMinor: 52_000n };
    expect(impliedAmortizationMonths(thin)).toBe(600);
    // A payment between two annuities takes the first period whose annuity fits under it.
    const between = { ...terms, paymentMinor: 70_000n };
    const months = impliedAmortizationMonths(between);
    expect(contractualPaymentMinor({ principalMinor: 10_000_000n, annualRatePpm: 60_000, termMonths: months }) <= 70_000n).toBe(true);
    expect(contractualPaymentMinor({ principalMinor: 10_000_000n, annualRatePpm: 60_000, termMonths: months - 1 }) > 70_000n).toBe(true);
  });

  it("refuses two rate rows on one date and a bad rate", () => {
    const twice = [{ effectiveDate: "2027-01-01", annualRatePpm: 1 }, { effectiveDate: "2027-01-01", annualRatePpm: 2 }];
    expect(codeOf(() => buildLoanSchedule({ ...base, rates: twice }))).toBe("rate_date");
    expect(codeOf(() => buildLoanSchedule({ ...base, rates: [{ effectiveDate: "2027-13-01", annualRatePpm: 1 }] }))).toBe("rate_date");
    expect(codeOf(() => buildLoanSchedule({ ...base, rates: [{ effectiveDate: "2027-01-01", annualRatePpm: -1 }] }))).toBe("rate");
  });
});

describe("demand loans (decision 0132)", () => {
  const demand = { principalMinor: 5_000_000n, annualRatePpm: 73_000, startDate: "2026-01-01" };

  it("accrues daily on actual/365 from the start, rounded half to even", () => {
    // 50,000.00 at 7.3%: 10.00 a day.
    const accrual = demandAccrual(demand, [], "2026-01-31");
    expect(accrual).toEqual({ fromDate: "2026-01-01", days: 30, balanceMinor: 5_000_000n, carriedMinor: 0n, interestMinor: 30_000n });
    // Half a minor unit rounds to even: 10.00 at 18.25% for one day is 0.5 minor units.
    expect(demandAccrual({ principalMinor: 1_000n, annualRatePpm: 182_500, startDate: "2026-01-01" }, [], "2026-01-02").interestMinor).toBe(0n);
    expect(demandAccrual({ principalMinor: 3_000n, annualRatePpm: 182_500, startDate: "2026-01-01" }, [], "2026-01-02").interestMinor).toBe(2n);
  });

  it("runs from the last attached payment, on the balance it left", () => {
    const paid = [{ date: "2026-03-01", interestMinor: 59_000n, escrowMinor: 0n, principalMinor: 1_000_000n, feesMinor: 0n }];
    const accrual = demandAccrual(demand, paid, "2026-03-11");
    expect(accrual.fromDate).toBe("2026-03-01");
    expect(accrual.days).toBe(10);
    expect(accrual.balanceMinor).toBe(4_000_000n);
    expect(accrual.interestMinor).toBe(divHalfEven(4_000_000n * 73_000n * 10n, 365n * 1_000_000n));
    // A payment on the same day as the last one accrues nothing; a date before the start neither.
    expect(demandAccrual(demand, paid, "2026-03-01").interestMinor).toBe(0n);
    expect(demandAccrual(demand, [], "2025-12-01").interestMinor).toBe(0n);
  });

  it("a 0% demand loan accrues nothing, so a payment is all principal", () => {
    const zero = { ...demand, annualRatePpm: 0 };
    expect(demandAccrual(zero, [], "2027-01-01")).toEqual({ fromDate: "2026-01-01", days: 365, balanceMinor: 5_000_000n, carriedMinor: 0n, interestMinor: 0n });
  });

  it("splits the days at a rate change", () => {
    const rates = [{ effectiveDate: "2026-01-11", annualRatePpm: 146_000 }];
    // 10 days at 10.00 a day, then 20 days at 20.00 a day.
    expect(demandAccrual({ ...demand, rates }, [], "2026-01-31").interestMinor).toBe(50_000n);
    // A change before the period sets the rate for all of it. The payment on 2026-01-20
    // pays the 280.00 accrued to it (10 days at 10.00, 9 at 20.00), so nothing is carried.
    const paid = [{ date: "2026-01-20", interestMinor: 28_000n, escrowMinor: 0n, principalMinor: 0n, feesMinor: 0n }];
    expect(demandAccrual({ ...demand, rates }, paid, "2026-01-30")).toEqual({
      fromDate: "2026-01-20", days: 10, balanceMinor: 5_000_000n, carriedMinor: 0n, interestMinor: 20_000n,
    });
  });

  it("the statement lists the attached payments with the balance after each, then what has accrued", () => {
    const payments = [
      { date: "2026-04-01", interestMinor: 10_000n, escrowMinor: 0n, principalMinor: 500_000n, feesMinor: 0n },
      { date: "2026-02-01", interestMinor: 31_000n, escrowMinor: 0n, principalMinor: 1_000_000n, feesMinor: 2_500n },
    ];
    const { rows, accrued } = demandStatement(demand, payments, "2026-04-11");
    expect(rows.map((row) => [row.dueDate, row.paymentMinor, row.balanceMinor])).toEqual([
      ["2026-02-01", 1_033_500n, 4_000_000n],
      ["2026-04-01", 510_000n, 3_500_000n],
    ]);
    expect(accrued.fromDate).toBe("2026-04-01");
    expect(accrued.balanceMinor).toBe(3_500_000n);
    // 40,000.00 at 7.3% from 2026-02-01 to 2026-04-01 (59 days at 8.00) is 472.00; the
    // payment paid 100.00 of it, so 372.00 is carried. Then 35,000.00 for 10 days: 70.00.
    expect(accrued.carriedMinor).toBe(37_200n);
    expect(accrued.interestMinor).toBe(37_200n + 7_000n);
  });

  it("carries the interest a short payment leaves unpaid, and a later payment pays it as interest first", () => {
    // 50,000.00 at 8% from 2026-01-01: 90 days to 2026-04-01 accrue 986.30.
    const loan = { principalMinor: 5_000_000n, annualRatePpm: 80_000, startDate: "2026-01-01" };
    const due = demandAccrual(loan, [], "2026-04-01");
    expect(due.interestMinor).toBe(98_630n);
    // A 500.00 payment is all interest; 486.30 is still owed.
    const short = { date: "2026-04-01", interestMinor: 50_000n, escrowMinor: 0n, principalMinor: 0n, feesMinor: 0n };
    const after = demandAccrual(loan, [short], "2026-05-01");
    expect(after.fromDate).toBe("2026-04-01");
    expect(after.carriedMinor).toBe(48_630n);
    // 30 more days on 50,000.00 (simple interest: the carried 486.30 earns nothing): 328.77.
    const month = divHalfEven(5_000_000n * 80_000n * 30n, 365n * 1_000_000n);
    expect(month).toBe(32_877n);
    expect(after.interestMinor).toBe(48_630n + 32_877n);
    // A 2,000.00 payment on 2026-05-01 then books 815.07 of interest and 1,184.93 of principal.
    const principal = 200_000n - after.interestMinor;
    expect(principal).toBe(118_493n);
    const paid = { date: "2026-05-01", interestMinor: after.interestMinor, escrowMinor: 0n, principalMinor: principal, feesMinor: 0n };
    const settled = demandAccrual(loan, [paid, short], "2026-05-11");
    expect(settled.carriedMinor).toBe(0n);
    expect(settled.balanceMinor).toBe(5_000_000n - principal);
    expect(settled.interestMinor).toBe(divHalfEven((5_000_000n - principal) * 80_000n * 10n, 365n * 1_000_000n));
    // An interest part above what was due carries nothing back.
    const over = { ...short, interestMinor: 200_000n };
    expect(demandAccrual(loan, [over], "2026-04-02").carriedMinor).toBe(0n);
    // The statement shows the same carried figure.
    expect(demandStatement(loan, [short], "2026-05-01").accrued).toEqual(after);
  });

  it("refuses a bad principal, rate or date", () => {
    expect(() => demandAccrual({ ...demand, principalMinor: 0n }, [], "2026-02-01")).toThrow("principal");
    expect(() => demandAccrual({ ...demand, annualRatePpm: 1_000_001 }, [], "2026-02-01")).toThrow("rate");
    expect(() => demandAccrual(demand, [], "2026-02-30")).toThrow("start_date");
  });
});
