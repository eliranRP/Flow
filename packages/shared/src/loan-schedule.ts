import { divHalfEven } from "./money.ts";

/** Nominal annual rate scale. 60_000 is 6 percent. 1_000_000 is 100 percent. */
export const RATE_PPM_SCALE = 1_000_000;

/**
 * Matches `loans_term_chk` in `supabase/migrations/20261004055306_loans_l1.sql`.
 * A longer term is refused here and in the database.
 */
export const LOAN_TERM_MONTHS_MAX = 600;

const MONTHS_IN_YEAR = 12n;
const MONTHLY_DENOMINATOR = MONTHS_IN_YEAR * BigInt(RATE_PPM_SCALE);
/** One minor unit. A shortfall must be strictly greater than this to be a balloon. */
const ONE_CENT = 1n;

export type LoanScheduleErrorCode =
  | "principal"
  | "rate"
  | "term"
  | "payment"
  | "escrow"
  | "start_date"
  | "payment_below_interest";

export class LoanScheduleError extends Error {
  readonly code: LoanScheduleErrorCode;

  constructor(code: LoanScheduleErrorCode) {
    super(code);
    this.name = "LoanScheduleError";
    this.code = code;
  }
}

export type LoanTerms = {
  readonly principalMinor: bigint;
  /** Parts per million. 60_000 is 6 percent. */
  readonly annualRatePpm: number;
  readonly termMonths: number;
  /** Due date of payment 1, as YYYY-MM-DD. Later rows step one calendar month. */
  readonly startDate: string;
  readonly paymentMinor: bigint;
  readonly escrowMinor: bigint;
};

export type LoanScheduleRow = {
  readonly period: number;
  readonly dueDate: string;
  readonly interestMinor: bigint;
  readonly escrowMinor: bigint;
  readonly principalMinor: bigint;
  readonly paymentMinor: bigint;
  readonly balanceMinor: bigint;
};

/**
 * Set when principal-and-interest is more than one cent below the exact annuity.
 * Escrow is not part of that comparison. `amountMinor` is the final payment.
 */
export type LoanBalloon = {
  /** The final payment, in the loan's minor units. */
  readonly amountMinor: bigint;
  readonly ratioToPayment: number;
};

export type LoanSchedule = {
  readonly rows: readonly LoanScheduleRow[];
  readonly balloon: LoanBalloon | null;
};

type DateParts = { year: number; month: number; day: number };

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseStartDate(iso: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match == null) throw new LoanScheduleError("start_date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new LoanScheduleError("start_date");
  }
  return { year, month, day };
}

function formatDate(parts: DateParts): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${String(parts.year)}-${month}-${day}`;
}

function shiftMonths(start: DateParts, add: number): string {
  const index = start.year * 12 + (start.month - 1) + add;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(start.day, daysInMonth(year, month));
  return formatDate({ year, month, day });
}

function assertTerms(terms: LoanTerms): void {
  if (terms.principalMinor <= 0n) throw new LoanScheduleError("principal");
  if (!Number.isSafeInteger(terms.annualRatePpm) || terms.annualRatePpm < 0 || terms.annualRatePpm > RATE_PPM_SCALE) {
    throw new LoanScheduleError("rate");
  }
  if (
    !Number.isSafeInteger(terms.termMonths) ||
    terms.termMonths < 1 ||
    terms.termMonths > LOAN_TERM_MONTHS_MAX
  ) {
    throw new LoanScheduleError("term");
  }
  if (terms.paymentMinor <= 0n) throw new LoanScheduleError("payment");
  if (terms.escrowMinor < 0n || terms.escrowMinor >= terms.paymentMinor) {
    throw new LoanScheduleError("escrow");
  }
  parseStartDate(terms.startDate);
}

function powBig(base: bigint, exponent: number): bigint {
  let result = 1n;
  let factor = base;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result *= factor;
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor *= factor;
  }
  return result;
}

/** Exact unrounded annuity, as a rational in minor units. Zero rate is principal / term. */
function exactAnnuity(
  principalMinor: bigint,
  annualRatePpm: number,
  termMonths: number,
): { numerator: bigint; denominator: bigint } {
  if (annualRatePpm === 0) return { numerator: principalMinor, denominator: BigInt(termMonths) };
  const rate = BigInt(annualRatePpm);
  const grown = powBig(MONTHLY_DENOMINATOR + rate, termMonths);
  const untouched = powBig(MONTHLY_DENOMINATOR, termMonths);
  return {
    numerator: principalMinor * rate * grown,
    denominator: MONTHLY_DENOMINATOR * (grown - untouched),
  };
}

/** True when principal-and-interest is more than one minor unit below the exact annuity. */
function piBelowAnnuity(terms: LoanTerms): boolean {
  const pi = terms.paymentMinor - terms.escrowMinor;
  const { numerator, denominator } = exactAnnuity(terms.principalMinor, terms.annualRatePpm, terms.termMonths);
  return numerator > (pi + ONE_CENT) * denominator;
}

function balloonOf(rows: readonly LoanScheduleRow[], terms: LoanTerms): LoanBalloon | null {
  if (!piBelowAnnuity(terms)) return null;
  const last = rows.at(-1);
  if (last == null) return null;
  return {
    amountMinor: last.paymentMinor,
    ratioToPayment: Number(last.paymentMinor) / Number(terms.paymentMinor),
  };
}

/**
 * Monthly schedule in the loan's minor units.
 * Interest is the remaining balance times the nominal annual rate divided by 12,
 * rounded half to even. A month that would not finish inside the term pays the
 * rest of the balance. A payment that clears the balance early ends the schedule.
 * `balloon` is set only when principal-and-interest is more than one cent below
 * the exact, unrounded annuity. Escrow is excluded from that comparison.
 */
export function buildLoanSchedule(terms: LoanTerms): LoanSchedule {
  assertTerms(terms);
  const start = parseStartDate(terms.startDate);
  const rate = BigInt(terms.annualRatePpm);
  const rows: LoanScheduleRow[] = [];
  let balance = terms.principalMinor;

  for (let period = 1; period <= terms.termMonths && balance > 0n; period += 1) {
    const interestMinor = divHalfEven(balance * rate, MONTHLY_DENOMINATOR);
    const escrowMinor = terms.escrowMinor;
    const available = terms.paymentMinor - escrowMinor;
    if (available < interestMinor) throw new LoanScheduleError("payment_below_interest");
    const contractualPrincipal = available - interestMinor;
    const last = period === terms.termMonths;
    const principalMinor = last || contractualPrincipal >= balance ? balance : contractualPrincipal;
    const paymentMinor = interestMinor + escrowMinor + principalMinor;
    balance -= principalMinor;
    rows.push({
      period,
      dueDate: shiftMonths(start, period - 1),
      interestMinor,
      escrowMinor,
      principalMinor,
      paymentMinor,
      balanceMinor: balance,
    });
  }

  return { rows, balloon: balloonOf(rows, terms) };
}

function assertAnnuityInput(input: {
  readonly principalMinor: bigint;
  readonly annualRatePpm: number;
  readonly termMonths: number;
}): void {
  if (input.principalMinor <= 0n) throw new LoanScheduleError("principal");
  if (!Number.isSafeInteger(input.annualRatePpm) || input.annualRatePpm < 0 || input.annualRatePpm > RATE_PPM_SCALE) {
    throw new LoanScheduleError("rate");
  }
  if (
    !Number.isSafeInteger(input.termMonths) ||
    input.termMonths < 1 ||
    input.termMonths > LOAN_TERM_MONTHS_MAX
  ) {
    throw new LoanScheduleError("term");
  }
}

/**
 * The exact annuity rounded half to even, in minor units.
 * Escrow is not included. The start date does not change the payment.
 */
export function contractualPaymentMinor(input: {
  readonly principalMinor: bigint;
  readonly annualRatePpm: number;
  readonly termMonths: number;
}): bigint {
  assertAnnuityInput(input);
  const { numerator, denominator } = exactAnnuity(input.principalMinor, input.annualRatePpm, input.termMonths);
  return divHalfEven(numerator, denominator);
}
