import type { LoanScheduleRow } from "./loan-schedule.ts";

/** A payment's parts. `fees` is optional: at most one, above zero (decision 0129). */
export type LoanSplitPart = "interest" | "escrow" | "principal" | "fees";

export type LoanSplitAmount = {
  readonly part: LoanSplitPart;
  readonly amountMinor: bigint;
  /** The schedule figure, kept so a later correction can be compared. */
  readonly scheduledMinor: bigint;
};

/** The three parts every split has, in display order. */
const PARTS = ["interest", "escrow", "principal"] as const;

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
 * Fees come off the line first, then `allocateLoanSplit` splits the rest
 * (decision 0129). Fees above zero add a fourth part whose scheduled figure is
 * the fees amount. Zero fees give the three parts alone. Returns null when the
 * line is smaller than the fees.
 */
export function allocateLoanSplitWithFees(input: {
  readonly lineMinor: bigint;
  readonly feesMinor: bigint;
  readonly interestMinor: bigint;
  readonly escrowMinor: bigint;
  readonly principalMinor: bigint;
}): readonly LoanSplitAmount[] | null {
  if (input.feesMinor < 0n) throw new Error("fees");
  if (input.lineMinor < input.feesMinor) return null;
  const parts = allocateLoanSplit({
    lineMinor: input.lineMinor - input.feesMinor,
    interestMinor: input.interestMinor,
    escrowMinor: input.escrowMinor,
    principalMinor: input.principalMinor,
  });
  if (input.feesMinor === 0n) return parts;
  return [...parts, { part: "fees", amountMinor: input.feesMinor, scheduledMinor: input.feesMinor }];
}

/** Interest, escrow and principal of several schedule rows added together. */
export type ScheduledSum = {
  readonly interestMinor: bigint;
  readonly escrowMinor: bigint;
  readonly principalMinor: bigint;
};

/**
 * The sum of `count` consecutive schedule rows from `start` (an index into `rows`).
 * Null when `count` is below 1 or the rows run past the schedule.
 */
export function sumScheduleRows(
  rows: readonly LoanScheduleRow[],
  start: number,
  count: number,
): ScheduledSum | null {
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1) return null;
  if (start + count > rows.length) return null;
  let interestMinor = 0n;
  let escrowMinor = 0n;
  let principalMinor = 0n;
  for (const row of rows.slice(start, start + count)) {
    interestMinor += row.interestMinor;
    escrowMinor += row.escrowMinor;
    principalMinor += row.principalMinor;
  }
  return { interestMinor, escrowMinor, principalMinor };
}

/**
 * The index of the first schedule row not yet paid: the first row where the
 * scheduled principal through that row is more than the principal already paid
 * (the loan's principal minus its current balance). -1 when every row is paid.
 */
export function firstUnpaidRowIndex(
  rows: readonly LoanScheduleRow[],
  paidPrincipalMinor: bigint,
): number {
  let through = 0n;
  for (const [index, row] of rows.entries()) {
    through += row.principalMinor;
    if (through > paidPrincipalMinor) return index;
  }
  return -1;
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
