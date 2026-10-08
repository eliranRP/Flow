import type { LoanScheduleRow } from "./loan-schedule.ts";

export type LoanSplitPart = "interest" | "escrow" | "principal";

export type LoanSplitAmount = {
  readonly part: LoanSplitPart;
  readonly amountMinor: bigint;
  /** The schedule figure, kept so a later correction can be compared. */
  readonly scheduledMinor: bigint;
};

const PARTS: readonly LoanSplitPart[] = ["interest", "escrow", "principal"];

/**
 * Three parts that sum to the bank line.
 * The scheduled figures stay as given. Principal absorbs the difference.
 * When the line is smaller than interest plus escrow, principal is zero and
 * the remainder comes out of escrow, then interest. Every amount stays at least zero.
 */
export function allocateLoanSplit(input: {
  readonly lineMinor: bigint;
  readonly interestMinor: bigint;
  readonly escrowMinor: bigint;
  readonly principalMinor: bigint;
}): readonly LoanSplitAmount[] {
  if (input.lineMinor < 0n) throw new Error("line");
  if (input.interestMinor < 0n || input.escrowMinor < 0n || input.principalMinor < 0n) {
    throw new Error("part");
  }
  const scheduled = {
    interest: input.interestMinor,
    escrow: input.escrowMinor,
    principal: input.principalMinor,
  };
  let interest = scheduled.interest;
  let escrow = scheduled.escrow;
  let principal = input.lineMinor - interest - escrow;
  if (principal < 0n) {
    const shortfall = -principal;
    principal = 0n;
    const fromEscrow = shortfall > escrow ? escrow : shortfall;
    escrow -= fromEscrow;
    interest -= shortfall - fromEscrow;
  }
  const amounts = { interest, escrow, principal };
  return PARTS.map((part) => ({
    part,
    amountMinor: amounts[part],
    scheduledMinor: scheduled[part],
  }));
}

/**
 * The schedule row for a bank date.
 * An exact due date wins, then the same calendar month, then the latest row
 * on or before the date. A payment before the first month has no row.
 */
export function scheduleRowForDate(
  rows: readonly LoanScheduleRow[],
  docDate: string,
): LoanScheduleRow | null {
  if (rows.length === 0) return null;
  const exact = rows.find((row) => row.dueDate === docDate);
  if (exact) return exact;
  const month = docDate.slice(0, 7);
  const sameMonth = rows.find((row) => row.dueDate.slice(0, 7) === month);
  if (sameMonth) return sameMonth;
  let latest: LoanScheduleRow | null = null;
  for (const row of rows) {
    if (row.dueDate <= docDate) latest = row;
  }
  return latest;
}

export type LoanStatus = "open" | "paid_off" | "closed";

/**
 * Whether a loan takes a payment dated `docDate`. An open loan takes any date.
 * A paid-off or closed loan takes only payments on or before `closedOn`, so its
 * history can still be attached. Matches `private.loan_splits_closed_check`.
 * A missing status reads as open.
 */
export function loanTakesPaymentOn(
  loan: { readonly status?: LoanStatus | null; readonly closedOn?: string | null },
  docDate: string,
): boolean {
  if (loan.status == null || loan.status === "open") return true;
  return loan.closedOn != null && docDate <= loan.closedOn;
}
