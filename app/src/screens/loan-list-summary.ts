import type { LoanDetail } from "./loan-detail-data";
import type { LoanOutlook, PartTotals } from "./loan-outlook";

/**
 * FLOW-139 (the Loans tab). The figures the list's summary card shows, from each open loan's
 * outlook. Pure, no reads. Every loan here is in one currency: the caller filters by currency,
 * because amounts in two currencies do not add.
 */

export type LoanListEntry = { loan: LoanDetail; outlook: LoanOutlook | null };

export type LoanListSummary = {
  /** Open loans, counted for the "N פעילות" line. */
  openCount: number;
  /** סך החוב היום: every open loan's balance. */
  totalBalanceMinor: bigint;
  /** תשלומים בחודש: each open loan's next payment, part by part. */
  monthlyParts: PartTotals;
  monthlyMinor: bigint;
  /** הבא: the earliest next payment, with its loan. Null when no open loan has one. */
  next: { loanId: string; lenderName: string; dueDate: string; amountMinor: bigint } | null;
  /** 12 החודשים הבאים: the next 12 payments of every open loan. */
  twelveMonthsMinor: bigint;
};

const ZERO_PARTS: PartTotals = { interest: 0n, escrow: 0n, principal: 0n, fees: 0n };

/** The open loans of one currency, summed. A loan with no outlook (a demand loan, a closed one) adds its balance only. */
export function loanListSummary(entries: readonly LoanListEntry[]): LoanListSummary {
  const monthlyParts: PartTotals = { ...ZERO_PARTS };
  let totalBalanceMinor = 0n;
  let twelveMonthsMinor = 0n;
  let openCount = 0;
  let next: LoanListSummary["next"] = null;
  for (const { loan, outlook } of entries) {
    if (loan.status !== "open") continue;
    openCount += 1;
    totalBalanceMinor += loan.balanceMinor;
    if (outlook == null) continue;
    monthlyParts.principal += outlook.next.principalMinor;
    monthlyParts.interest += outlook.next.interestMinor;
    monthlyParts.escrow += outlook.next.escrowMinor;
    twelveMonthsMinor += outlook.ahead.totalMinor;
    const amountMinor = outlook.next.principalMinor + outlook.next.interestMinor + outlook.next.escrowMinor;
    if (next == null || outlook.next.dueDate < next.dueDate) {
      next = { loanId: loan.id, lenderName: loan.name, dueDate: outlook.next.dueDate, amountMinor };
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
