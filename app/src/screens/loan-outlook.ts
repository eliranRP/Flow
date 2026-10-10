import { buildLoanSchedule, type LoanScheduleRow, type LoanSplitPart, type LoanTerms } from "@flow/shared";
import { HEBREW_MONTHS } from "../ui/date-math";
import { keyedCategory, type LoanCategory, type LoanDetail, type LoanPayment } from "./loan-detail-data";
import { LOAN_PART_LABEL } from "./loan-copy";

/**
 * FLOW-434: what the loan page leads with (owner's pick A, 2026-10-10). The next payment, the
 * months ahead by year with their parts, and what was paid this year. Pure, no reads.
 */

export type PartTotals = Record<LoanSplitPart, bigint>;

export type PartShare = { part: LoanSplitPart; minor: bigint; percent: number };

export type OutlookPeriod = {
  /** "2027", or "end" for the rest of the loan. */
  key: string;
  totals: PartTotals;
  totalMinor: bigint;
  payments: number;
};

export type LoanOutlook = {
  next: LoanScheduleRow;
  /** The next 12 payments (fewer near the end). */
  ahead: OutlookPeriod;
  /** Calendar years from the next payment on, oldest first. */
  years: OutlookPeriod[];
  /** Every payment left on the schedule. */
  toEnd: OutlookPeriod;
  /** The year of the last scheduled payment. */
  endYear: string;
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
  const byYear = new Map<string, LoanScheduleRow[]>();
  for (const row of left) {
    const year = row.dueDate.slice(0, 4);
    const list = byYear.get(year) ?? [];
    list.push(row);
    byYear.set(year, list);
  }
  return {
    next,
    ahead: sumRows("ahead", left.slice(0, 12)),
    years: [...byYear.entries()].map(([year, list]) => sumRows(year, list)),
    toEnd: sumRows("end", left),
    endYear: left.at(-1)?.dueDate.slice(0, 4) ?? next.dueDate.slice(0, 4),
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
 * The parts with their whole-percent share, the shares adding up to 100 (largest remainder).
 * Escrow shows only when the loan files it; fees only when there are any.
 */
export function partShares(totals: PartTotals, parts: readonly LoanSplitPart[]): PartShare[] {
  const shown = parts.filter((part) => part !== "fees" || totals.fees > 0n);
  const total = shown.reduce((sum, part) => sum + totals[part], 0n);
  if (total <= 0n) return shown.map((part) => ({ part, minor: totals[part], percent: 0 }));
  const raw = shown.map((part) => {
    const scaled = totals[part] * 10_000n / total;
    return { part, minor: totals[part], floor: Number(scaled / 100n), rest: Number(scaled % 100n) };
  });
  let missing = 100 - raw.reduce((sum, item) => sum + item.floor, 0);
  const order = [...raw].sort((a, b) => b.rest - a.rest);
  for (const item of order) {
    if (missing <= 0) break;
    item.floor += 1;
    missing -= 1;
  }
  return raw.map((item) => ({ part: item.part, minor: item.minor, percent: item.floor }));
}

/** A part's category name for its hint, or null when it would only repeat the part's own label. */
export function partCategoryHint(loan: Pick<LoanDetail, "categoryIds">, categories: readonly LoanCategory[], part: LoanSplitPart): string | null {
  const id = loan.categoryIds[part];
  const name = (id == null ? null : categories.find((category) => category.id === id)?.name) ?? keyedCategory(categories, part)?.name ?? null;
  return name == null || name === LOAN_PART_LABEL[part] ? null : name;
}

/** "1 בנובמבר" for a due date. */
export function dueDayLabel(iso: string): string {
  const month = HEBREW_MONTHS[Number(iso.slice(5, 7)) - 1];
  return month == null ? iso : `${String(Number(iso.slice(8, 10)))} ב${month}`;
}

/** Rounded to whole units, for the summary rows (no .00 and no cents on a projection). */
export function wholeMinor(minor: bigint): bigint {
  return ((minor + 50n) / 100n) * 100n;
}
