import { buildLoanSchedule, type LoanScheduleRow, type LoanSplitPart, type LoanTerms } from "@flow/shared";
import type { LoanDetail, LoanPayment } from "./loan-detail-data";

/**
 * FLOW-434: what the loan page leads with (owner's pick A, 2026-10-10). The next payment, the
 * payments left, and what was paid this year. Pure, no reads.
 */

export type PartTotals = Record<LoanSplitPart, bigint>;

export type OutlookPeriod = {
  /** "2027", or "end" for the rest of the loan. */
  key: string;
  totals: PartTotals;
  totalMinor: bigint;
  payments: number;
};

export type LoanOutlook = {
  next: LoanScheduleRow;
  /** The next 12 payments (fewer near the end): the list's "12 החודשים הבאים". */
  ahead: OutlookPeriod;
  /** Every payment left on the schedule. */
  toEnd: OutlookPeriod;
  /** The year of the last scheduled payment. */
  endYear: string;
  /** The due date of the last scheduled payment, ISO. */
  endDate: string;
};

const PART_KEYS = ["interest", "escrow", "principal", "fees"] as const;

const NONE: PartTotals = { interest: 0n, escrow: 0n, principal: 0n, fees: 0n };

function sumRows(key: string, rows: readonly LoanScheduleRow[]): OutlookPeriod {
  const totals: PartTotals = { ...NONE };
  for (const row of rows) {
    totals.interest += row.interestMinor;
    totals.escrow += row.escrowMinor;
    totals.principal += row.principalMinor;
  }
  return { key, totals, totalMinor: totals.interest + totals.escrow + totals.principal, payments: rows.length };
}

/**
 * The schedule from the payment due today or later. Null for a demand loan or a loan that ended.
 * FLOW-427 (C20-1): the payments left start from the balance in the books, not from where the
 * original terms would have it, so the principal to the end is the balance shown. They keep the
 * loan's own payment, the one the bank charges and the page leads with, and its months of interest
 * only and its balloon; a balance below the schedule ends the loan sooner, one above it leaves more
 * for the last payment.
 */
export function loanOutlook(loan: LoanDetail, today: string): LoanOutlook | null {
  if (loan.status !== "open" || loan.kind === "demand" || loan.termMonths == null || loan.paymentMinor == null) return null;
  if (loan.balanceMinor <= 0n) return null;
  const rates = [...loan.rates].reverse().map((rate) => ({ effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm }));
  const terms: LoanTerms = {
    principalMinor: loan.principalMinor,
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    paymentMinor: loan.paymentMinor,
    escrowMinor: loan.escrowMinor,
    kind: loan.kind,
    interestOnlyMonths: loan.interestOnlyMonths,
    amortizationMonths: loan.amortizationMonths,
    rates,
  };
  let left: readonly LoanScheduleRow[];
  try {
    const first = buildLoanSchedule(terms).rows.find((row) => row.dueDate >= today);
    if (first == null) return null;
    left = remainingFromBalance(terms, loan.balanceMinor, first);
  } catch {
    return null;
  }
  const next = left[0];
  if (next == null) return null;
  const endDate = left.at(-1)?.dueDate ?? next.dueDate;
  return {
    next,
    ahead: sumRows("ahead", left.slice(0, 12)),
    toEnd: sumRows("end", left),
    endYear: endDate.slice(0, 4),
    endDate,
  };
}

/** The payments from `first` on, from `balanceMinor` instead of the schedule's balance (FLOW-427). */
function remainingFromBalance(terms: LoanTerms, balanceMinor: bigint, first: LoanScheduleRow): LoanScheduleRow[] {
  const done = first.period - 1;
  const kind = terms.kind ?? "amortizing";
  const interestOnlyLeft = kind === "interest_only" ? (terms.interestOnlyMonths ?? 0) - done : 0;
  return buildLoanSchedule({
    ...terms,
    principalMinor: balanceMinor,
    termMonths: terms.termMonths - done,
    startDate: first.dueDate,
    // Past its months of interest only, the loan amortizes over the rest of its term.
    kind: kind === "interest_only" && interestOnlyLeft <= 0 ? "amortizing" : kind,
    interestOnlyMonths: interestOnlyLeft > 0 ? interestOnlyLeft : null,
    amortizationMonths: terms.amortizationMonths == null ? null : terms.amortizationMonths - done,
  }).rows.map((row) => ({ ...row, period: row.period + done }));
}

/** What the attached payments of a calendar year paid, part by part. */
export function paidInYear(payments: readonly LoanPayment[], year: string): OutlookPeriod {
  const totals: PartTotals = { ...NONE };
  let count = 0;
  for (const payment of payments) {
    if (!payment.docDate.startsWith(`${year}-`)) continue;
    totals.interest += payment.interestMinor;
    totals.escrow += payment.escrowMinor;
    totals.principal += payment.principalMinor;
    totals.fees += payment.feesMinor;
    count += 1;
  }
  return { key: year, totals, totalMinor: totals.interest + totals.escrow + totals.principal + totals.fees, payments: count };
}

/**
 * Each part in whole units, rounded so the parts on screen add up to the rounded total (the
 * part with the largest remainder takes the leftover unit).
 */
export function roundTotals(totals: PartTotals): PartTotals {
  const target = wholeMinor(PART_KEYS.reduce((sum, key) => sum + totals[key], 0n));
  const out: PartTotals = { interest: 0n, escrow: 0n, principal: 0n, fees: 0n };
  for (const key of PART_KEYS) out[key] = (totals[key] / 100n) * 100n;
  let left = target - PART_KEYS.reduce((sum, key) => sum + out[key], 0n);
  for (const key of [...PART_KEYS].sort((a, b) => Number((totals[b] % 100n) - (totals[a] % 100n)))) {
    if (left <= 0n) break;
    out[key] += 100n;
    left -= 100n;
  }
  return out;
}

/** The rounded total, equal to the rounded parts on screen. */
export function periodTotal(totals: PartTotals): bigint {
  const rounded = roundTotals(totals);
  return PART_KEYS.reduce((sum, key) => sum + rounded[key], 0n);
}

/** Rounded to whole units, for the summary rows (no .00 and no cents on a projection). */
export function wholeMinor(minor: bigint): bigint {
  return ((minor + 50n) / 100n) * 100n;
}
