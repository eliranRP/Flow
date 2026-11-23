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
export type OutlookLoan = ScheduleLoan & Pick<LoanDetail, "status" | "balanceMinor">;

/** The loan's fields the schedule reads. */
export type ScheduleLoan = Pick<
  LoanDetail,
  "kind" | "termMonths" | "paymentMinor" | "rates" | "principalMinor" | "annualRatePpm" | "startDate" | "escrowMinor" | "interestOnlyMonths" | "amortizationMonths"
>;

/**
 * The terms buildLoanSchedule takes for a loan, as the loan page passes them (its rates oldest first).
 * Null for a demand loan, or one with no term or payment: it has no schedule.
 */
export function loanScheduleTerms(loan: ScheduleLoan): LoanTerms | null {
  if (loan.kind === "demand" || loan.termMonths == null || loan.paymentMinor == null) return null;
  return {
    principalMinor: loan.principalMinor,
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    paymentMinor: loan.paymentMinor,
    escrowMinor: loan.escrowMinor,
    kind: loan.kind,
    interestOnlyMonths: loan.interestOnlyMonths,
    amortizationMonths: loan.amortizationMonths,
    rates: [...loan.rates].reverse().map((rate) => ({ effectiveDate: rate.effectiveDate, annualRatePpm: rate.annualRatePpm })),
  };
}

/**
 * The loan's schedule on its own terms, the rows the payment reads start from: an open loan's, or null for a demand
 * loan, one that ended, or terms the schedule refuses. It does not depend on today or on the balance, so a read
 * builds it once per loan and passes it to paymentsLeft, latePayment and loanOutlook (FLOW-1260).
 */
export function scheduleRowsOf(loan: OutlookLoan): readonly LoanScheduleRow[] | null {
  if (loan.status !== "open") return null;
  const terms = loanScheduleTerms(loan);
  if (terms == null) return null;
  try {
    return buildLoanSchedule(terms).rows;
  } catch {
    return null;
  }
}

/**
 * The payments due today or later, from the balance in the books (FLOW-427). Null for a demand loan, one
 * that ended, or terms the schedule refuses. The loan page's outlook and the project forecast's loan rows
 * (decision 0190) both read it, so the two show the same payment. `rows` is scheduleRowsOf(loan), passed in
 * when the caller already has it.
 */
export function paymentsLeft(loan: OutlookLoan, today: string, rows: readonly LoanScheduleRow[] | null = scheduleRowsOf(loan)): readonly LoanScheduleRow[] | null {
  if (loan.status !== "open" || loan.balanceMinor <= 0n || rows == null) return null;
  const terms = loanScheduleTerms(loan);
  if (terms == null) return null;
  try {
    const first = rows.find((row) => row.dueDate >= today);
    return first == null ? null : remainingFromBalance(terms, loan.balanceMinor, first);
  } catch {
    return null;
  }
}

export function loanOutlook(loan: OutlookLoan, today: string, rows: readonly LoanScheduleRow[] | null = scheduleRowsOf(loan)): LoanOutlook | null {
  const left = paymentsLeft(loan, today, rows);
  if (left == null) return null;
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

/** FLOW-1258: a payment is late this many days after its due date with nothing recorded for it. */
const LATE_GRACE_DAYS = 10;

/** FLOW-1258: a payment recorded up to this many days before a due date pays that date (paid early). */
const EARLY_PAY_DAYS = 15;

/** `iso` (yyyy-mm-dd) moved by `days`. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * FLOW-1258: the due date of the latest scheduled payment past its grace (LATE_GRACE_DAYS) with no payment recorded
 * for it: none on or after EARLY_PAY_DAYS before its due date. `lastPaidOn` is the loan's latest posted payment, a
 * payment waiting for review included (null with none). Null for a loan that is on time, a demand loan, a closed
 * one, or one with no schedule. Only the latest past date is checked, and a loan with no payment in the books at all
 * is late only for its first payment: the books may start after the loan did, so a loan whose history predates them
 * is not called late on its first day. One payment pays one date: a late payment made within EARLY_PAY_DAYS of the
 * next date covers that date too, so a missed month right after a late one shows a month later.
 */
export function latePayment(loan: OutlookLoan, lastPaidOn: string | null, today: string, rows: readonly LoanScheduleRow[] | null = scheduleRowsOf(loan)): string | null {
  if (loan.status !== "open" || loan.balanceMinor <= 0n || rows == null) return null;
  const cutoff = addDays(today, -LATE_GRACE_DAYS);
  const due = rows.filter((row) => row.dueDate < cutoff).at(-1);
  if (due == null) return null;
  if (lastPaidOn == null) return due === rows[0] ? due.dueDate : null;
  if (lastPaidOn >= addDays(due.dueDate, -EARLY_PAY_DAYS)) return null;
  return due.dueDate;
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

/** What the attached payments paid, part by part: in one calendar year ("2026"), or since the loan started ("all"). */
export function paidInPeriod(payments: readonly LoanPayment[], period: string): OutlookPeriod {
  const totals: PartTotals = { ...NONE };
  let count = 0;
  for (const payment of payments) {
    if (period !== "all" && !payment.docDate.startsWith(`${period}-`)) continue;
    totals.interest += payment.interestMinor;
    totals.escrow += payment.escrowMinor;
    totals.principal += payment.principalMinor;
    totals.fees += payment.feesMinor;
    count += 1;
  }
  return { key: period, totals, totalMinor: totals.interest + totals.escrow + totals.principal + totals.fees, payments: count };
}

/** Rounded to whole units, for the summary rows (no .00 and no cents on a projection). */
export function wholeMinor(minor: bigint): bigint {
  return ((minor + 50n) / 100n) * 100n;
}
