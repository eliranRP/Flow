import type { LoanSplitPart } from "@flow/shared";
import { LOAN_KIND_LIST_LABEL } from "./loan-copy";
import { keyedCategory, type LoanCategory, type LoanDetail, type LoanPayment } from "./loan-detail-data";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import { wholeMinor, type LoanOutlook } from "./loan-outlook";

/**
 * FLOW-139c: the pure helpers behind the loan page's cards and the all-payments page (no reads,
 * no React). Money on these pages is whole units; the rows of a payment keep their own cents.
 */

/** The names the loan page's cards use for the parts (the terms rows and sheets keep LOAN_PART_LABEL). */
export const LOAN_PART_BOARD_LABEL: Record<LoanSplitPart, string> = {
  principal: "קרן",
  interest: "ריבית",
  escrow: "נאמנות (escrow)",
  fees: "עמלות",
};

/** dd/mm from an ISO date. */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** mm/yyyy from an ISO date. */
export function monthYear(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** A whole-unit amount, as the cards show it: "$176,500". */
export function wholeMoney(minor: bigint, currency: LoanCurrency): string {
  return formatLoanMoney(wholeMinor(minor), currency);
}

/** The paid part of the principal and what is left of it. The paid part never goes below zero. */
export function balanceProgress(loan: Pick<LoanDetail, "principalMinor" | "balanceMinor">): { paidMinor: bigint; remainingMinor: bigint } {
  const paid = loan.principalMinor - loan.balanceMinor;
  return { paidMinor: paid > 0n ? paid : 0n, remainingMinor: loan.balanceMinor };
}

/**
 * The line under the balance: "נפרע $X מתוך $Y · לתשלום עד 2030", or for a loan that pays only
 * interest until the end, "ריבית בלבד: הקרן ($Y) תיפרע בסוף, 11/2030".
 */
export function balanceProgressText(loan: Pick<LoanDetail, "kind" | "principalMinor" | "balanceMinor" | "currency">, outlook: LoanOutlook): string {
  const { paidMinor } = balanceProgress(loan);
  if (loan.kind === "interest_only") {
    return `ריבית בלבד: הקרן (${wholeMoney(loan.balanceMinor, loan.currency)}) תיפרע בסוף, ${monthYear(outlook.endDate)}`;
  }
  return `נפרע ${wholeMoney(paidMinor, loan.currency)} מתוך ${wholeMoney(loan.principalMinor, loan.currency)} · לתשלום עד ${outlook.endYear}`;
}

/** The line under the title: "שיפוץ דוגמה 12 · פריסה רגילה · מאז 01/2025" (no project: "ללא פרויקט"). */
export function loanSubtitle(loan: Pick<LoanDetail, "kind" | "startDate">, projectName: string | null): string {
  return `${projectName ?? "ללא פרויקט"} · ${LOAN_KIND_LIST_LABEL[loan.kind]} · מאז ${monthYear(loan.startDate)}`;
}

/** The category a part is booked to: the loan's own, else the keyed default. Null for fees with none. */
export function partCategory(loan: Pick<LoanDetail, "categoryIds">, categories: readonly LoanCategory[], part: LoanSplitPart): LoanCategory | null {
  const id = loan.categoryIds[part];
  return (id == null ? null : categories.find((category) => category.id === id)) ?? keyedCategory(categories, part);
}

/**
 * Whether a part counts in the company's profit: its category's flag; a principal with no category
 * is kept out, as the keyed principal category is.
 */
export function partInProfit(loan: Pick<LoanDetail, "categoryIds">, categories: readonly LoanCategory[], part: LoanSplitPart): boolean {
  const category = partCategory(loan, categories, part);
  if (category == null) return part !== "principal";
  return !category.excludedFromPnl;
}

export type PaymentRow = {
  transactionId: string;
  /** dd/mm, as the list shows it. */
  date: string;
  dateIso: string;
  principalMinor: bigint;
  interestMinor: bigint;
  escrowMinor: bigint;
  feesMinor: bigint;
  totalMinor: bigint;
  needsReview: boolean;
};

export type PaymentYear = {
  year: string;
  count: number;
  totalMinor: bigint;
  rows: PaymentRow[];
};

export type PaymentTotals = { principal: bigint; interest: bigint; escrow: bigint; fees: bigint; total: bigint };

/** The attached payments' parts and total. The total is the sum of the four parts. */
export function paymentTotals(payments: readonly LoanPayment[]): PaymentTotals {
  const totals = { principal: 0n, interest: 0n, escrow: 0n, fees: 0n, total: 0n };
  for (const payment of payments) {
    totals.principal += payment.principalMinor;
    totals.interest += payment.interestMinor;
    totals.escrow += payment.escrowMinor;
    totals.fees += payment.feesMinor;
    totals.total += payment.totalMinor;
  }
  return totals;
}

/** One payment as a row of the all-payments page and the loan page's recent list. */
export function paymentRow(payment: LoanPayment): PaymentRow {
  return {
    transactionId: payment.transactionId,
    date: dayMonth(payment.docDate),
    dateIso: payment.docDate,
    principalMinor: payment.principalMinor,
    interestMinor: payment.interestMinor,
    escrowMinor: payment.escrowMinor,
    feesMinor: payment.feesMinor,
    totalMinor: payment.totalMinor,
    needsReview: payment.needsReview,
  };
}

/**
 * The payments grouped by the year of their date, newest year first, each year's rows newest
 * first (a tie keeps the order the payments came in, which readLoanPayments makes stable).
 */
export function loanPaymentYears(payments: readonly LoanPayment[]): PaymentYear[] {
  const byYear = new Map<string, PaymentRow[]>();
  for (const payment of payments) {
    const year = payment.docDate.slice(0, 4);
    const list = byYear.get(year) ?? [];
    list.push(paymentRow(payment));
    byYear.set(year, list);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([year, rows]) => {
      const sorted = [...rows].sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
      return { year, count: sorted.length, totalMinor: sorted.reduce((sum, row) => sum + row.totalMinor, 0n), rows: sorted };
    });
}

/**
 * A payment's split under its date: "קרן $3,937 · ריבית $940 · עמלות $26". The principal is left
 * out when it is zero (interest only), and so are the fees when there are none. Escrow is not here:
 * it is in the split card.
 */
export function paymentSplitText(row: Pick<PaymentRow, "principalMinor" | "interestMinor" | "feesMinor">, currency: LoanCurrency): string {
  const parts: string[] = [];
  if (row.principalMinor !== 0n) parts.push(`קרן ${wholeMoney(row.principalMinor, currency)}`);
  if (row.interestMinor !== 0n) parts.push(`ריבית ${wholeMoney(row.interestMinor, currency)}`);
  if (row.feesMinor !== 0n) parts.push(`עמלות ${wholeMoney(row.feesMinor, currency)}`);
  return parts.join(" · ");
}
