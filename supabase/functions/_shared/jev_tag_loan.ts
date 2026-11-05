// Tagging job: a loan payment Jev filed under a loan category is split onto its loan instead
// (FLOW-1032, decision 0254). Pure: the match and the split, from rows SQL gave.

import {
  buildLoanSchedule,
  LoanScheduleError,
  monthlyPaymentMinor,
  type LoanKind,
  type LoanRate,
} from "../../../packages/shared/src/loan-schedule.ts";
import {
  allocateLoanSplitWithFees,
  loanTakesPaymentOn,
  scheduleRowForDate,
  type LoanSplitAmount,
  type LoanStatus,
} from "../../../packages/shared/src/loan-split.ts";

/** An open loan with a schedule, as `jev_loan_candidates` returns it. */
export type TagLoan = {
  id: string;
  currency: string;
  kind: LoanKind;
  status: LoanStatus;
  closedOn: string | null;
  principalMinor: bigint;
  annualRatePpm: number;
  termMonths: number;
  startDate: string;
  paymentMinor: bigint;
  escrowMinor: bigint;
  interestOnlyMonths: number | null;
  amortizationMonths: number | null;
  balanceMinor: bigint;
  rates: LoanRate[];
  /** The amount of the newest payment attached to this loan, if any. */
  lastPaymentMinor: bigint | null;
};

/** The line as the match needs it: its unsigned amount in its own currency, and its date. */
export type LoanLine = { amountMinor: bigint; currency: string; docDate: string };

export type LoanFill = { loanId: string; parts: readonly LoanSplitAmount[] };

const KINDS = new Set<LoanKind>(["amortizing", "interest_only", "balloon"]);
const STATUSES = new Set<LoanStatus>(["open", "closed", "paid_off"]);

function int(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?[0-9]{1,18}$/.test(value)) return BigInt(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** One `jev_loan_candidates` row, or null when it is not one the job can use. */
export function loanFromRow(row: unknown): TagLoan | null {
  if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const id = text(r.id);
  const currency = text(r.currency);
  const kind = text(r.kind) as LoanKind | null;
  const status = text(r.status) as LoanStatus | null;
  const startDate = text(r.start_date);
  const principalMinor = int(r.principal_minor);
  const paymentMinor = int(r.payment_minor);
  const escrowMinor = int(r.escrow_minor);
  const balanceMinor = int(r.balance_minor);
  const termMonths = typeof r.term_months === "number" ? r.term_months : null;
  const annualRatePpm = typeof r.annual_rate_ppm === "number" ? r.annual_rate_ppm : null;
  if (
    !id || !currency || !kind || !KINDS.has(kind) || !status || !STATUSES.has(status) || !startDate
    || principalMinor == null || paymentMinor == null || escrowMinor == null || balanceMinor == null
    || termMonths == null || annualRatePpm == null
  ) return null;
  const rates = Array.isArray(r.rates)
    ? r.rates.flatMap((rate) => {
      if (rate == null || typeof rate !== "object") return [];
      const effectiveDate = text((rate as Record<string, unknown>).effective_date);
      const ppm = (rate as Record<string, unknown>).annual_rate_ppm;
      return effectiveDate && typeof ppm === "number" ? [{ effectiveDate, annualRatePpm: ppm }] : [];
    })
    : [];
  return {
    id,
    currency,
    kind,
    status,
    closedOn: text(r.closed_on),
    principalMinor,
    annualRatePpm,
    termMonths,
    startDate,
    paymentMinor,
    escrowMinor,
    interestOnlyMonths: typeof r.interest_only_months === "number" ? r.interest_only_months : null,
    amortizationMonths: typeof r.amortization_months === "number" ? r.amortization_months : null,
    balanceMinor,
    rates,
    lastPaymentMinor: int(r.last_payment_minor),
  };
}

/** The monthly payment due on the line's date (an interest-only loan's moves with its rate). */
function paymentOn(loan: TagLoan, docDate: string): bigint {
  return monthlyPaymentMinor({
    principalMinor: loan.principalMinor,
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    paymentMinor: loan.paymentMinor,
    escrowMinor: loan.escrowMinor,
    kind: loan.kind,
    interestOnlyMonths: loan.interestOnlyMonths,
    rates: loan.rates,
    asOf: docDate,
  });
}

/**
 * The one loan this payment belongs to: a loan in the line's currency that takes a payment on
 * its date whose monthly payment equals the line; else whose last attached payment equals it (the
 * same recurring payment after an escrow change). Null when no loan, or more than one, matches.
 */
export function matchLoan(line: LoanLine, loans: readonly TagLoan[]): TagLoan | null {
  if (line.amountMinor <= 0n) return null;
  const usable = loans.filter((loan) =>
    loan.currency === line.currency
    && loan.balanceMinor > 0n
    && line.docDate >= loan.startDate.slice(0, 7) + "-01"
    && loanTakesPaymentOn({ status: loan.status, closedOn: loan.closedOn }, line.docDate)
  );
  const byPayment = usable.filter((loan) => paymentOn(loan, line.docDate) === line.amountMinor);
  if (byPayment.length > 0) return byPayment.length === 1 ? byPayment[0] : null;
  const byLast = usable.filter((loan) => loan.lastPaymentMinor === line.amountMinor);
  return byLast.length === 1 ? byLast[0] : null;
}

/**
 * The split `attach_loan_payment` would write with no parts given: the schedule row for the
 * line's date, principal taking any difference. Null when the loan has no row for it, its terms
 * no longer build a schedule, or the principal would pass the balance.
 */
export function loanSplit(line: LoanLine, loan: TagLoan): readonly LoanSplitAmount[] | null {
  let rows;
  try {
    rows = buildLoanSchedule({
      principalMinor: loan.principalMinor,
      annualRatePpm: loan.annualRatePpm,
      termMonths: loan.termMonths,
      startDate: loan.startDate,
      paymentMinor: loan.paymentMinor,
      escrowMinor: loan.escrowMinor,
      kind: loan.kind,
      interestOnlyMonths: loan.interestOnlyMonths,
      amortizationMonths: loan.amortizationMonths,
      rates: loan.rates,
    }).rows;
  } catch (error) {
    if (error instanceof LoanScheduleError) return null;
    throw error;
  }
  const row = scheduleRowForDate(rows, line.docDate);
  if (row == null) return null;
  const parts = allocateLoanSplitWithFees({
    lineMinor: line.amountMinor,
    feesMinor: 0n,
    interestMinor: row.interestMinor,
    escrowMinor: row.escrowMinor,
    principalMinor: row.principalMinor,
  });
  if (parts == null) return null;
  const principal = parts.find((part) => part.part === "principal")?.amountMinor ?? 0n;
  return principal > loan.balanceMinor ? null : parts;
}

/** The loan and the parts for this line, or null when it is not one loan's payment. */
export function planLoanFill(line: LoanLine, loans: readonly TagLoan[]): LoanFill | null {
  const loan = matchLoan(line, loans);
  if (loan == null) return null;
  const parts = loanSplit(line, loan);
  return parts == null ? null : { loanId: loan.id, parts };
}
