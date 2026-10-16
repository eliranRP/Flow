import type { LoanDetail } from "./loan-detail-data";
import type { LoanCurrency } from "./loan-form";
import type { LoanOutlook } from "./loan-outlook";

/**
 * FLOW-139 (the Loans tab). The figures the list's summary card shows, from each open loan's
 * outlook. Pure, no reads. Every loan here is in one currency: the caller filters by currency,
 * because amounts in two currencies do not add.
 */

export type LoanListEntry = { loan: LoanDetail; outlook: LoanOutlook | null };

export type LoanListSummary = {
  /** Open loans in the currency. */
  openCount: number;
  /** סך החוב היום: every open loan's balance. */
  totalBalanceMinor: bigint;
  /** תשלומים בחודש: each open loan's next payment, part by part. */
  monthlyParts: { principal: bigint; interest: bigint; escrow: bigint };
  monthlyMinor: bigint;
  /** הבא: the earliest next payment, with its loan. Null when no open loan has one. */
  next: { lenderName: string; dueDate: string; amountMinor: bigint } | null;
  /** 12 החודשים הבאים: the next 12 payments of every open loan. */
  twelveMonthsMinor: bigint;
};

/** The open loans of one currency, summed. A loan with no outlook (a demand loan) adds its balance only. */
export function loanListSummary(entries: readonly LoanListEntry[], currency: LoanCurrency): LoanListSummary {
  const monthlyParts = { principal: 0n, interest: 0n, escrow: 0n };
  let totalBalanceMinor = 0n;
  let twelveMonthsMinor = 0n;
  let openCount = 0;
  let next: LoanListSummary["next"] = null;
  for (const { loan, outlook } of entries) {
    if (loan.status !== "open" || loan.currency !== currency) continue;
    openCount += 1;
    totalBalanceMinor += loan.balanceMinor;
    if (outlook == null) continue;
    monthlyParts.principal += outlook.next.principalMinor;
    monthlyParts.interest += outlook.next.interestMinor;
    monthlyParts.escrow += outlook.next.escrowMinor;
    twelveMonthsMinor += outlook.ahead.totalMinor;
    const amountMinor = outlook.next.principalMinor + outlook.next.interestMinor + outlook.next.escrowMinor;
    if (next == null || outlook.next.dueDate < next.dueDate) {
      next = { lenderName: loan.name, dueDate: outlook.next.dueDate, amountMinor };
    }
  }
  return {
    openCount,
    totalBalanceMinor,
    monthlyParts,
    monthlyMinor: monthlyParts.principal + monthlyParts.interest + monthlyParts.escrow,
    next,
    twelveMonthsMinor,
  };
}
