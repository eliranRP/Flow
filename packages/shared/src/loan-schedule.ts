import { divHalfEven } from "./money.ts";

/** Nominal annual rate scale. 60_000 is 6 percent. 1_000_000 is 100 percent. */
export const RATE_PPM_SCALE = 1_000_000;

const MONTHS_IN_YEAR = 12n;
const MONTHLY_DENOMINATOR = MONTHS_IN_YEAR * BigInt(RATE_PPM_SCALE);

export type LoanTerms = {
  principalMinor: bigint;
  /** Parts per million. 60_000 is 6 percent. */
  annualRatePpm: number;
  termMonths: number;
  /** Due date of payment 1, as YYYY-MM-DD. Later rows step one calendar month. */
  startDate: string;
  paymentMinor: bigint;
  escrowMinor: bigint;
};

export type LoanScheduleRow = {
  period: number;
  dueDate: string;
  interestMinor: bigint;
  escrowMinor: bigint;
  principalMinor: bigint;
  paymentMinor: bigint;
  balanceMinor: bigint;
};

type DateParts = { year: number; month: number; day: number };

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseStartDate(iso: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match == null) throw new Error("start date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("start date");
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
  if (terms.principalMinor <= 0n) throw new Error("principal");
  if (!Number.isSafeInteger(terms.annualRatePpm) || terms.annualRatePpm < 0 || terms.annualRatePpm > RATE_PPM_SCALE) {
    throw new Error("rate");
  }
  if (!Number.isSafeInteger(terms.termMonths) || terms.termMonths < 1 || terms.termMonths > 600) {
    throw new Error("term");
  }
  if (terms.paymentMinor <= 0n) throw new Error("payment");
  if (terms.escrowMinor < 0n || terms.escrowMinor >= terms.paymentMinor) throw new Error("escrow");
  parseStartDate(terms.startDate);
}

/**
 * Monthly schedule in the loan's minor units.
 * Interest is the remaining balance times the nominal annual rate divided by 12,
 * rounded half to even. A month that would not finish inside the term pays the
 * rest of the balance. A payment that clears the balance early ends the schedule.
 */
export function buildLoanSchedule(terms: LoanTerms): LoanScheduleRow[] {
  assertTerms(terms);
  const start = parseStartDate(terms.startDate);
  const rate = BigInt(terms.annualRatePpm);
  const rows: LoanScheduleRow[] = [];
  let balance = terms.principalMinor;

  for (let period = 1; period <= terms.termMonths && balance > 0n; period += 1) {
    const interestMinor = divHalfEven(balance * rate, MONTHLY_DENOMINATOR);
    const escrowMinor = terms.escrowMinor;
    const available = terms.paymentMinor - escrowMinor;
    if (available < interestMinor) throw new Error("payment does not cover interest and escrow");
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

  return rows;
}
