import {
  allocateLoanSplitWithFees,
  buildLoanSchedule,
  demandAccrual,
  firstUnpaidRowIndex,
  paidInterestAndPrincipal,
  parseShekelInput,
  scheduleRowForDate,
  sumScheduleRows,
  type LoanSplitAmount,
  type LoanSplitPart,
  type ScheduledSum,
} from "@flow/shared";
import { formatDisplay } from "../ui/date-math";
import type { LoanPayment } from "./loan-detail-data";
import type { LoanChoice, SavePart } from "./loan-match-api";
import { LOAN_INSTALLMENTS_MAX, type OfferLine } from "./loan-match-offer";

/**
 * FLOW-106 §3.4, the split editor "פיצול התשלום": the schedule's figures for 1 to 12 installments
 * (a demand loan: its accrued interest), and the parts a save sends.
 */
export type SchedulePlan = {
  sum: ScheduledSum;
  /** How many installments the line can cover from where it starts (1 for a demand loan). */
  maxCount: number;
  /** "01/06–01/08/2026", or one due date; null for a demand loan. */
  dates: string | null;
};

function counted(payments: readonly LoanPayment[], line: OfferLine): LoanPayment[] {
  return payments.filter((payment) => !payment.needsReview && payment.transactionId !== line.transactionId);
}

function dateSpan(from: string, to: string): string {
  if (from === to) return formatDisplay(from);
  // Same year: "01/06–01/08/2026"; else both dates in full.
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatDisplay(from).slice(0, 5)}–${formatDisplay(to)}`;
  return `${formatDisplay(from)}–${formatDisplay(to)}`;
}

/**
 * The schedule figures for `count` installments. One installment is the row for the line's date,
 * as one tap writes it; more start at the first unpaid row. Null when the loan has no row then.
 */
export function schedulePlan(loan: LoanChoice, payments: readonly LoanPayment[], line: OfferLine, count: number): SchedulePlan | null {
  if (loan.kind === "demand") {
    if (line.docDate < loan.startDate) return null;
    const interestMinor = demandAccrual(
      { principalMinor: BigInt(loan.principalMinor), annualRatePpm: loan.annualRatePpm, startDate: loan.startDate, rates: loan.rates ?? [] },
      counted(payments, line).map((payment) => ({
        date: payment.docDate,
        interestMinor: payment.interestMinor,
        escrowMinor: payment.escrowMinor,
        principalMinor: payment.principalMinor,
        feesMinor: payment.feesMinor,
      })),
      line.docDate,
    ).interestMinor;
    return { sum: { interestMinor, escrowMinor: 0n, principalMinor: 0n }, maxCount: 1, dates: null };
  }
  if (loan.termMonths == null || loan.paymentMinor == null) return null;
  const rows = buildLoanSchedule({
    principalMinor: BigInt(loan.principalMinor),
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    paymentMinor: BigInt(loan.paymentMinor),
    escrowMinor: BigInt(loan.escrowMinor),
    kind: loan.kind,
    interestOnlyMonths: loan.interestOnlyMonths ?? null,
    amortizationMonths: loan.amortizationMonths ?? null,
    rates: loan.rates ?? [],
  }).rows;
  const paid = paidInterestAndPrincipal(payments.map((payment) => ({
    transactionId: payment.transactionId,
    interestMinor: payment.interestMinor,
    principalMinor: payment.principalMinor,
    needsReview: payment.needsReview,
  })), line.transactionId);
  const first = firstUnpaidRowIndex(rows, paid);
  const maxCount = first < 0 ? 1 : Math.max(1, Math.min(LOAN_INSTALLMENTS_MAX, rows.length - first));
  if (count <= 1 || first < 0) {
    const row = scheduleRowForDate(rows, line.docDate);
    if (row == null) return null;
    return {
      sum: { interestMinor: row.interestMinor, escrowMinor: row.escrowMinor, principalMinor: row.principalMinor },
      maxCount,
      dates: formatDisplay(row.dueDate),
    };
  }
  const take = Math.min(count, maxCount);
  const sum = sumScheduleRows(rows, first, take);
  const start = rows[first];
  const end = rows[first + take - 1];
  if (sum == null || start == null || end == null) return null;
  return { sum, maxCount, dates: dateSpan(start.dueDate, end.dueDate) };
}

/** The parts of a schedule-mode save: fees off the top, the rest by the schedule (decision 0130). */
export function scheduleParts(plan: SchedulePlan, lineMinor: bigint, feesMinor: bigint): readonly LoanSplitAmount[] | null {
  return allocateLoanSplitWithFees({ lineMinor, feesMinor, ...plan.sum });
}

/** A money field's digits as minor units: null when empty or not a non-negative amount. */
export function minorOfInput(raw: string | undefined): bigint | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const minor = parseShekelInput(raw);
    return minor < 0n ? null : minor;
  } catch {
    return null;
  }
}

export type ExactDraft = Partial<Record<LoanSplitPart, string>>;

export type ExactCheck = {
  /** The parts typed so far added up; an empty field counts as 0. */
  totalMinor: bigint;
  /** Line minus total: above 0 is still to split, below 0 is over the line. */
  leftMinor: bigint;
  /** A field that isn't an amount. */
  invalid: boolean;
};

const EXACT_PARTS: readonly LoanSplitPart[] = ["principal", "interest", "escrow", "fees"];

export function checkExact(draft: ExactDraft, lineMinor: bigint): ExactCheck {
  let total = 0n;
  let invalid = false;
  for (const part of EXACT_PARTS) {
    const raw = draft[part];
    if (raw == null || raw.trim() === "") continue;
    const minor = minorOfInput(raw);
    if (minor == null) invalid = true;
    else total += minor;
  }
  return { totalMinor: total, leftMinor: lineMinor - total, invalid };
}

/**
 * The exact parts as save_loan_split takes them: interest, escrow and principal always (an empty
 * field is 0), fees only above 0. The scheduled figures are the schedule's for the line's date.
 */
export function exactParts(draft: ExactDraft, plan: SchedulePlan | null): Array<{ part: LoanSplitPart; amountMinor: bigint; scheduledMinor: bigint }> {
  const amount = (part: LoanSplitPart) => minorOfInput(draft[part]) ?? 0n;
  const scheduled: Record<Exclude<LoanSplitPart, "fees">, bigint> = {
    interest: plan?.sum.interestMinor ?? 0n,
    escrow: plan?.sum.escrowMinor ?? 0n,
    principal: plan?.sum.principalMinor ?? 0n,
  };
  const parts: Array<{ part: LoanSplitPart; amountMinor: bigint; scheduledMinor: bigint }> = (["interest", "escrow", "principal"] as const)
    .map((part) => ({ part, amountMinor: amount(part), scheduledMinor: scheduled[part] }));
  const fees = amount("fees");
  if (fees > 0n) parts.push({ part: "fees", amountMinor: fees, scheduledMinor: fees });
  return parts;
}

/** The parts as the save sends them; the fees part names its category (decision 0130). */
export function toSaveParts(
  parts: ReadonlyArray<{ part: LoanSplitPart; amountMinor: bigint; scheduledMinor: bigint }>,
  feesCategoryId: string | null,
): SavePart[] {
  return parts.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
    ...(part.part === "fees" && feesCategoryId != null ? { category_id: feesCategoryId } : {}),
  }));
}
