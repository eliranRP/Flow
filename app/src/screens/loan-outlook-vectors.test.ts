import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LoanKind, LoanStatus } from "@flow/shared";
import { latePayment, loanOutlook, type OutlookLoan } from "./loan-outlook";

/**
 * FLOW-1310: the shared loan-outlook vectors (packages/shared/fixtures/vectors/loan-outlook, format in its README) run
 * through this screen's own builders, loanOutlook and latePayment. The database core private.loan_outlook_build runs the
 * same files (supabase/tests/database/vectors_loan_outlook.test.sql), so the Loans list reads the same figures from
 * either. The builders live in the app, so the test does too (packages/shared cannot import them).
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/shared/fixtures/vectors/loan-outlook");

type Amounts = Record<string, number | string | null | undefined | unknown[]>;
type Vector = {
  name: string;
  description?: string;
  input: { today: string; loan: Amounts & { status: LoanStatus; balanceMinor: number }; paid: { lastPaidOn: string | null; addedOn: string | null } };
  expected: Record<string, unknown>;
};

function load(): Vector[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      for (const literal of text.match(/-?\d{16,}/g) ?? []) expect(BigInt(literal) <= max, `${file}: ${literal} is inside 2^53 - 1`).toBe(true);
      const vector = JSON.parse(text) as Vector;
      expect(file, "the file is named after the vector").toBe(`${vector.name}.json`);
      return vector;
    });
}

/** The JSON loan as the screen's builders take it: bigint amounts, the rates newest first (as a LoanDetail holds them). */
function toLoan(json: Vector["input"]["loan"]): OutlookLoan {
  const big = (value: unknown) => BigInt(value as number);
  const rates = ((json.rates ?? []) as Array<{ effectiveDate: string; annualRatePpm: number }>)
    .map((rate, index) => ({ id: `rate-${String(index)}`, effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm }))
    .reverse();
  return {
    principalMinor: big(json.principalMinor),
    annualRatePpm: json.annualRatePpm as number,
    termMonths: json.termMonths as number | null,
    startDate: json.startDate as string,
    paymentMinor: json.paymentMinor == null ? null : big(json.paymentMinor),
    escrowMinor: big(json.escrowMinor),
    kind: json.kind as LoanKind,
    interestOnlyMonths: json.interestOnlyMonths as number | null,
    amortizationMonths: json.amortizationMonths as number | null,
    rates,
    status: json.status,
    balanceMinor: big(json.balanceMinor),
  };
}

/** What private.loan_outlook_build answers: the outlook and the late date, without what is null. */
function answer(vector: Vector): Record<string, unknown> {
  const { today, paid } = vector.input;
  const loan = toLoan(vector.input.loan);
  const outlook = loanOutlook(loan, today);
  const late = latePayment(loan, paid, today);
  const next = outlook?.next;
  return {
    ...(next == null ? {} : { next: {
      due_date: next.dueDate,
      interest_minor: Number(next.interestMinor),
      escrow_minor: Number(next.escrowMinor),
      principal_minor: Number(next.principalMinor),
      amount_minor: Number(next.interestMinor + next.escrowMinor + next.principalMinor),
    } }),
    ...(outlook == null ? {} : { ahead_minor: Number(outlook.ahead.totalMinor), to_end_minor: Number(outlook.toEnd.totalMinor), end_date: outlook.endDate }),
    ...(late == null ? {} : { late_on: late }),
  };
}

describe("shared vectors: loan-outlook", () => {
  const vectors = load();

  it("has the cases of loan-outlook.test.ts: each kind, interest-only months ahead, a balloon, a zero balance, a demand loan, a closed one, and FLOW-1258's late edges", () => {
    const names = vectors.map((vector) => vector.name);
    for (const part of ["amortizing-next", "due-today", "interest-only-months-ahead", "balloon", "balance-zero", "demand", "paid-off", "closed", "refuses", "late-waits-out", "late-after", "15-days", "16-days", "latest-past", "no-payment-added", "day-unknown", "first-grace"]) {
      expect(names.some((name) => name.includes(part)), part).toBe(true);
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expect(answer(vector)).toEqual(vector.expected);
  });
});
