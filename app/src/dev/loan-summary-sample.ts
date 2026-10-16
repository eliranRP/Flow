import type { LoanListSummary } from "../screens/loan-list-summary";

/**
 * FLOW-139. The list's summary card on invented loans in USD, the board's figures: 634,900 owed,
 * 10,182.50 a month (4,477 principal, 5,062.50 interest, 643 escrow), the next payment 1,837.50 on
 * 2026-11-01, and 122,190 over the next twelve months. Shared by the card's stories and the proof route.
 */
export const LOAN_SUMMARY_SAMPLE: LoanListSummary = {
  openCount: 4,
  totalBalanceMinor: 63_490_000n,
  monthlyParts: { principal: 447_700n, interest: 506_250n, escrow: 64_300n },
  monthlyMinor: 1_018_250n,
  next: { loanId: "ember", lenderName: "Ember", dueDate: "2026-11-01", amountMinor: 183_750n },
  twelveMonthsMinor: 12_219_000n,
};
