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

/**
 * How a loan pays down (decision 0132). `amortizing` is every loan saved before FLOW-106
 * part 4. `interest_only` pays interest (and escrow) for `interestOnlyMonths`, then
 * amortizes over the months left. `balloon` pays the annuity over `amortizationMonths`
 * and ends at the term with the rest of the balance. `demand` has no term and no fixed
 * payment: see `demandAccrual`.
 */
export type LoanKind = "amortizing" | "interest_only" | "balloon" | "demand";

export const LOAN_KINDS: readonly LoanKind[] = ["amortizing", "interest_only", "balloon", "demand"];

/** Interest on a demand loan is daily on an actual/365 basis (decision 0132). */
export const DEMAND_DAYS_IN_YEAR = 365;

/**
 * A rate row: from `effectiveDate` on, the loan's nominal annual rate is `annualRatePpm`.
 * Before the first row the loan's own rate applies. Matches `public.loan_rates`.
 */
export type LoanRate = {
  readonly effectiveDate: string;
  readonly annualRatePpm: number;
};

export type LoanScheduleErrorCode =
  | "principal"
  | "rate"
  | "term"
  | "payment"
  | "escrow"
  | "start_date"
  | "payment_below_interest"
  | "kind"
  | "interest_only_months"
  | "amortization_months"
  | "rate_date";

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
  /** Absent reads as `amortizing`. `demand` has no schedule (`buildLoanSchedule` refuses it). */
  readonly kind?: LoanKind;
  /** `interest_only` only: 1 to the term. */
  readonly interestOnlyMonths?: number | null;
  /** `balloon` only: the term to 600. */
  readonly amortizationMonths?: number | null;
  /** Rate changes. The rate in force on a row's due date is used. */
  readonly rates?: readonly LoanRate[];
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
  /** The final principal-and-interest over the regular one (escrow left out of both). */
  readonly ratioToPayment: number;
};

/**
 * Set when the loan runs the full term and the final payment differs from the
 * regular one only because of rounding. An early payoff is not this.
 */
export type LoanFinalAdjustment = {
  /** The final payment, in the loan's minor units. */
  readonly amountMinor: bigint;
};

export type LoanSchedule = {
  readonly rows: readonly LoanScheduleRow[];
  readonly balloon: LoanBalloon | null;
  readonly finalAdjustment: LoanFinalAdjustment | null;
};

type DateParts = { year: number; month: number; day: number };

/**
 * Milliseconds since 1970-01-01 for a UTC day. `Date.UTC` maps years 0 to 99 to 1900 to
 * 1999, so the year is set on its own.
 */
function utcTime(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date.getTime();
}

function daysInMonth(year: number, month: number): number {
  return new Date(utcTime(year, month, 0)).getUTCDate();
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
  return `${String(parts.year).padStart(4, "0")}-${month}-${day}`;
}

function shiftMonths(start: DateParts, add: number): string {
  const index = start.year * 12 + (start.month - 1) + add;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(start.day, daysInMonth(year, month));
  return formatDate({ year, month, day });
}

/** Days since 1970-01-01 for a valid YYYY-MM-DD. */
function dayNumber(iso: string): number {
  const parts = parseStartDate(iso);
  return Math.round(utcTime(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function assertRatePpm(ppm: number): void {
  if (!Number.isSafeInteger(ppm) || ppm < 0 || ppm > RATE_PPM_SCALE) throw new LoanScheduleError("rate");
}

/** Rate rows sorted by date, each checked. Two rows on one date are refused. */
function sortedRates(rates: readonly LoanRate[] | undefined): LoanRate[] {
  const sorted = [...(rates ?? [])].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  for (const [index, rate] of sorted.entries()) {
    try {
      parseStartDate(rate.effectiveDate);
    } catch {
      throw new LoanScheduleError("rate_date");
    }
    assertRatePpm(rate.annualRatePpm);
    if (index > 0 && sorted[index - 1]?.effectiveDate === rate.effectiveDate) throw new LoanScheduleError("rate_date");
  }
  return sorted;
}

/** The rate in force on `date`: the latest row on or before it, else the loan's own rate. */
export function rateOnDate(baseRatePpm: number, rates: readonly LoanRate[], date: string): number {
  let rate = baseRatePpm;
  for (const row of rates) {
    if (row.effectiveDate <= date) rate = row.annualRatePpm;
  }
  return rate;
}

function assertKind(terms: LoanTerms): void {
  const kind = terms.kind ?? "amortizing";
  if (!LOAN_KINDS.includes(kind) || kind === "demand") throw new LoanScheduleError("kind");
  const io = terms.interestOnlyMonths ?? null;
  const amortization = terms.amortizationMonths ?? null;
  if (kind === "interest_only") {
    if (io == null || !Number.isSafeInteger(io) || io < 1 || io > terms.termMonths) {
      throw new LoanScheduleError("interest_only_months");
    }
  } else if (io != null) {
    throw new LoanScheduleError("interest_only_months");
  }
  if (kind === "balloon") {
    if (
      amortization == null ||
      !Number.isSafeInteger(amortization) ||
      amortization < terms.termMonths ||
      amortization > LOAN_TERM_MONTHS_MAX
    ) {
      throw new LoanScheduleError("amortization_months");
    }
  } else if (amortization != null) {
    throw new LoanScheduleError("amortization_months");
  }
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
  assertKind(terms);
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

/**
 * True when principal-and-interest is more than one minor unit below the exact annuity
 * of the principal over `months` (the term by default).
 */
function piBelowAnnuity(terms: LoanTerms, months: number = terms.termMonths): boolean {
  const pi = terms.paymentMinor - terms.escrowMinor;
  const { numerator, denominator } = exactAnnuity(terms.principalMinor, terms.annualRatePpm, months);
  return numerator > (pi + ONE_CENT) * denominator;
}

/**
 * The final row as a balloon. The ratio compares principal-and-interest on both sides,
 * like the test that sets the balloon, so a large escrow does not shrink it.
 */
function balloonFrom(last: LoanScheduleRow, terms: LoanTerms): LoanBalloon {
  return {
    amountMinor: last.paymentMinor,
    ratioToPayment: Number(last.paymentMinor - last.escrowMinor) / Number(terms.paymentMinor - terms.escrowMinor),
  };
}

function balloonOf(rows: readonly LoanScheduleRow[], terms: LoanTerms): LoanBalloon | null {
  if (!piBelowAnnuity(terms)) return null;
  const last = rows.at(-1);
  if (last == null) return null;
  return balloonFrom(last, terms);
}

function finalAdjustmentOf(rows: readonly LoanScheduleRow[], terms: LoanTerms): LoanFinalAdjustment | null {
  if (piBelowAnnuity(terms) || rows.length !== terms.termMonths) return null;
  const last = rows.at(-1);
  if (last == null || last.paymentMinor === terms.paymentMinor) return null;
  const pi = terms.paymentMinor - terms.escrowMinor;
  const level = contractualPaymentMinor({
    principalMinor: terms.principalMinor,
    annualRatePpm: terms.annualRatePpm,
    termMonths: terms.termMonths,
  });
  if (pi < level - ONE_CENT || pi > level + ONE_CENT) return null;
  return { amountMinor: last.paymentMinor };
}

/**
 * The amortization period an `amortizing` loan's stored payment implies (decision 0132):
 * the term when principal-and-interest covers the term annuity (within the one cent band),
 * else the smallest n from the term on whose annuity, rounded half to even like
 * `contractualPaymentMinor`, is at or below the stored principal-and-interest, at most
 * `LOAN_TERM_MONTHS_MAX`. A rate change on a loan with an implicit balloon recasts over
 * these months, not the term's, so the payment does not jump and the balloon stays.
 */
export function impliedAmortizationMonths(terms: LoanTerms): number {
  if (!piBelowAnnuity(terms)) return terms.termMonths;
  const pi = terms.paymentMinor - terms.escrowMinor;
  const annuity = (months: number) => contractualPaymentMinor({
    principalMinor: terms.principalMinor,
    annualRatePpm: terms.annualRatePpm,
    termMonths: months,
  });
  if (annuity(LOAN_TERM_MONTHS_MAX) > pi) return LOAN_TERM_MONTHS_MAX;
  // The annuity does not rise as the months grow, so search for the first that fits.
  let low = terms.termMonths;
  let high = LOAN_TERM_MONTHS_MAX;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (annuity(middle) <= pi) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Monthly schedule in the loan's minor units.
 * Interest is the remaining balance times the nominal annual rate in force on the row's
 * due date divided by 12, rounded half to even. A month that would not finish inside the
 * term pays the rest of the balance. A payment that clears the balance early ends the
 * schedule.
 *
 * By kind (decision 0132): an `interest_only` row inside `interestOnlyMonths` pays interest
 * and escrow only (the last one also the whole balance when those months are the term);
 * later rows use the stored payment. A `balloon` loan's stored payment is the annuity over
 * `amortizationMonths`, and the row at the term pays what is left.
 *
 * A rate change (`rates`) recasts the payment: from the first amortizing row whose rate
 * differs from the rate the payment was set at, principal-and-interest becomes the annuity
 * of the balance over the months left to amortize, rounded half to even. Those run to the
 * term, to `amortizationMonths` for a balloon, or, for an `amortizing` loan whose stored
 * payment is below the term annuity (an implicit balloon, decision 0088), to the end of the
 * amortization period that payment implies (`impliedAmortizationMonths`), so the balloon
 * stays at the term. Without rate rows nothing is recast, so every loan saved before this
 * change keeps its schedule exactly.
 *
 * `balloon` is set only when principal-and-interest is more than one cent below
 * the exact, unrounded annuity over the months that amortize (always for a `balloon` loan
 * that runs its term, and for an `interest_only` loan whose interest-only months are the
 * term; on those kinds also for a payment entered by hand below it, unless a rate change
 * recast it). Escrow is excluded from that comparison and from `ratioToPayment`.
 * `finalAdjustment` is the final payment when a full term ends on a
 * different amount only because of that rounding; an early payoff, a non-amortizing kind
 * or a recast leaves it null.
 */
export function buildLoanSchedule(terms: LoanTerms): LoanSchedule {
  assertTerms(terms);
  const rates = sortedRates(terms.rates);
  const start = parseStartDate(terms.startDate);
  const kind = terms.kind ?? "amortizing";
  const ioMonths = kind === "interest_only" ? (terms.interestOnlyMonths ?? 0) : 0;
  const amortizeTo = kind === "balloon"
    ? (terms.amortizationMonths ?? terms.termMonths)
    : kind === "amortizing" ? impliedAmortizationMonths(terms) : terms.termMonths;
  const rows: LoanScheduleRow[] = [];
  let balance = terms.principalMinor;
  let levelPi = terms.paymentMinor - terms.escrowMinor;
  let levelRate = terms.annualRatePpm;
  let recast = false;

  for (let period = 1; period <= terms.termMonths && balance > 0n; period += 1) {
    const dueDate = shiftMonths(start, period - 1);
    const rate = rateOnDate(terms.annualRatePpm, rates, dueDate);
    const interestMinor = divHalfEven(balance * BigInt(rate), MONTHLY_DENOMINATOR);
    const escrowMinor = terms.escrowMinor;
    const last = period === terms.termMonths;
    let principalMinor: bigint;
    if (period <= ioMonths) {
      principalMinor = last ? balance : 0n;
    } else {
      if (rate !== levelRate) {
        levelPi = contractualPaymentMinor({
          principalMinor: balance,
          annualRatePpm: rate,
          termMonths: amortizeTo - period + 1,
        });
        levelRate = rate;
        recast = true;
      }
      if (levelPi < interestMinor) throw new LoanScheduleError("payment_below_interest");
      const contractualPrincipal = levelPi - interestMinor;
      principalMinor = last || contractualPrincipal >= balance ? balance : contractualPrincipal;
    }
    const paymentMinor = interestMinor + escrowMinor + principalMinor;
    balance -= principalMinor;
    rows.push({
      period,
      dueDate,
      interestMinor,
      escrowMinor,
      principalMinor,
      paymentMinor,
      balanceMinor: balance,
    });
  }

  if (kind === "amortizing") {
    return {
      rows,
      balloon: balloonOf(rows, terms),
      finalAdjustment: recast ? null : finalAdjustmentOf(rows, terms),
    };
  }
  const reachesTerm = rows.length === terms.termMonths;
  // A payment entered by hand below the annuity over the months that amortize also leaves
  // a balloon at the term, unless a rate change recast it to the full annuity.
  const amortizingMonths = amortizeTo - ioMonths;
  const ballooned = (kind === "balloon" && amortizeTo > terms.termMonths) ||
    (kind === "interest_only" && ioMonths === terms.termMonths) ||
    (!recast && amortizingMonths > 0 && piBelowAnnuity(terms, amortizingMonths));
  const last = rows.at(-1);
  return {
    rows,
    balloon: reachesTerm && ballooned && last != null ? balloonFrom(last, terms) : null,
    finalAdjustment: null,
  };
}

/**
 * The regular payment of a new loan of this kind, escrow included (decision 0132):
 * the annuity over the term (`amortizing`), over `amortizationMonths` (`balloon`), or over
 * the months after the interest-only ones (`interest_only`; a single month when they are
 * the term, so the payment is the bullet), each rounded half to even.
 */
export function regularPaymentMinor(input: {
  readonly principalMinor: bigint;
  readonly annualRatePpm: number;
  readonly termMonths: number;
  readonly escrowMinor: bigint;
  readonly kind?: LoanKind;
  readonly interestOnlyMonths?: number | null;
  readonly amortizationMonths?: number | null;
}): bigint {
  const kind = input.kind ?? "amortizing";
  let months = input.termMonths;
  if (kind === "balloon") {
    const amortization = input.amortizationMonths ?? null;
    if (amortization == null || !Number.isSafeInteger(amortization) || amortization < input.termMonths || amortization > LOAN_TERM_MONTHS_MAX) {
      throw new LoanScheduleError("amortization_months");
    }
    months = amortization;
  } else if (kind === "interest_only") {
    const io = input.interestOnlyMonths ?? null;
    if (io == null || !Number.isSafeInteger(io) || io < 1 || io > input.termMonths) {
      throw new LoanScheduleError("interest_only_months");
    }
    months = Math.max(input.termMonths - io, 1);
  } else if (kind !== "amortizing") {
    throw new LoanScheduleError("kind");
  }
  return contractualPaymentMinor({
    principalMinor: input.principalMinor,
    annualRatePpm: input.annualRatePpm,
    termMonths: months,
  }) + input.escrowMinor;
}

/**
 * The monthly payment to show for a loan (FLOW-136): the stored payment, except on an
 * `interest_only` loan whose interest-only months are the term. Its stored payment is the
 * bullet due at the term (decision 0132), while every month before it pays the interest at
 * the loan's own rate, rounded half to even, plus escrow.
 */
export function monthlyPaymentMinor(input: {
  readonly principalMinor: bigint;
  readonly annualRatePpm: number;
  readonly termMonths: number;
  readonly paymentMinor: bigint;
  readonly escrowMinor: bigint;
  readonly kind?: LoanKind;
  readonly interestOnlyMonths?: number | null;
}): bigint {
  if (input.kind !== "interest_only" || input.interestOnlyMonths !== input.termMonths) return input.paymentMinor;
  return divHalfEven(input.principalMinor * BigInt(input.annualRatePpm), MONTHLY_DENOMINATOR) + input.escrowMinor;
}

/** Demand-loan interest for a period, as an exact numerator over `365 × RATE_PPM_SCALE`. */
function demandNumerator(
  balanceMinor: bigint,
  baseRatePpm: number,
  rates: readonly LoanRate[],
  fromDate: string,
  toDate: string,
): bigint {
  const from = dayNumber(fromDate);
  const to = dayNumber(toDate);
  if (to <= from || balanceMinor <= 0n) return 0n;
  // Each day of [from, to) takes the rate in force on that day.
  let numerator = 0n;
  let cursor = from;
  let rate = rateOnDate(baseRatePpm, rates, fromDate);
  for (const row of rates) {
    const day = dayNumber(row.effectiveDate);
    if (day <= cursor) continue;
    if (day >= to) break;
    numerator += balanceMinor * BigInt(rate) * BigInt(day - cursor);
    cursor = day;
    rate = row.annualRatePpm;
  }
  numerator += balanceMinor * BigInt(rate) * BigInt(to - cursor);
  return numerator;
}

const DEMAND_DENOMINATOR = BigInt(DEMAND_DAYS_IN_YEAR) * BigInt(RATE_PPM_SCALE);

/** A payment already attached to a demand loan, in date order. */
export type DemandPayment = {
  readonly date: string;
  readonly interestMinor: bigint;
  readonly escrowMinor: bigint;
  readonly principalMinor: bigint;
  readonly feesMinor: bigint;
};

export type DemandTerms = {
  readonly principalMinor: bigint;
  readonly annualRatePpm: number;
  /** The day the loan started: interest runs from here until the first payment. */
  readonly startDate: string;
  readonly rates?: readonly LoanRate[];
};

export type DemandAccrual = {
  /** The last attached payment's date, or the start date. */
  readonly fromDate: string;
  readonly days: number;
  /** Principal left after the attached payments. */
  readonly balanceMinor: bigint;
  /**
   * Interest accrued before the last attached payment that the payments did not pay
   * (decision 0132). It is part of `interestMinor`, and earns no interest itself.
   */
  readonly carriedMinor: bigint;
  /** Interest due on `asOf`: `carriedMinor` plus what accrued since `fromDate`. */
  readonly interestMinor: bigint;
};

function assertDemand(terms: DemandTerms): LoanRate[] {
  if (terms.principalMinor <= 0n) throw new LoanScheduleError("principal");
  assertRatePpm(terms.annualRatePpm);
  parseStartDate(terms.startDate);
  return sortedRates(terms.rates);
}

/**
 * Interest due on a demand loan on `asOf` (decision 0132). Simple interest, no compounding:
 * each period between attached payments (from the start, then from each payment to the
 * next) accrues the balance left at its start times the rate in force on each day, on an
 * actual/365 basis, and that period's exact figure is rounded half to even. A payment's
 * interest part pays that period's accrual and any carried before it; what it leaves
 * unpaid is carried forward (an interest part above what was due carries nothing back).
 * The result is the carried interest plus what has accrued since the last payment.
 * Payments are those dated on or before `asOf`, taken in date order; a later one is the
 * caller's to refuse. A date before the start, or on the last payment's date, accrues
 * nothing new.
 */
export function demandAccrual(terms: DemandTerms, payments: readonly DemandPayment[], asOf: string): DemandAccrual {
  const rates = assertDemand(terms);
  parseStartDate(asOf);
  const counted = payments
    .filter((payment) => payment.date <= asOf)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const accrue = (balance: bigint, from: string, to: string): bigint =>
    divHalfEven(demandNumerator(balance, terms.annualRatePpm, rates, from, to), DEMAND_DENOMINATOR);
  let balanceMinor = terms.principalMinor;
  let fromDate = terms.startDate;
  let carriedMinor = 0n;
  for (const payment of counted) {
    const open = balanceMinor < 0n ? 0n : balanceMinor;
    if (payment.date > fromDate) {
      carriedMinor += accrue(open, fromDate, payment.date);
      fromDate = payment.date;
    }
    carriedMinor -= payment.interestMinor;
    if (carriedMinor < 0n) carriedMinor = 0n;
    balanceMinor -= payment.principalMinor;
  }
  if (balanceMinor < 0n) balanceMinor = 0n;
  const days = Math.max(dayNumber(asOf) - dayNumber(fromDate), 0);
  const interestMinor = carriedMinor + accrue(balanceMinor, fromDate, asOf);
  return { fromDate, days, balanceMinor, carriedMinor, interestMinor };
}

/**
 * A demand loan's statement: one row per attached payment, in date order, with the
 * balance after it, then what has accrued from the last one to `asOf`.
 */
export function demandStatement(
  terms: DemandTerms,
  payments: readonly DemandPayment[],
  asOf: string,
): { readonly rows: readonly LoanScheduleRow[]; readonly accrued: DemandAccrual } {
  assertDemand(terms);
  const sorted = [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rows: LoanScheduleRow[] = [];
  let balance = terms.principalMinor;
  for (const [index, payment] of sorted.entries()) {
    balance -= payment.principalMinor;
    rows.push({
      period: index + 1,
      dueDate: payment.date,
      interestMinor: payment.interestMinor,
      escrowMinor: payment.escrowMinor,
      principalMinor: payment.principalMinor,
      paymentMinor: payment.interestMinor + payment.escrowMinor + payment.principalMinor + payment.feesMinor,
      balanceMinor: balance < 0n ? 0n : balance,
    });
  }
  return { rows, accrued: demandAccrual(terms, sorted, asOf) };
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
