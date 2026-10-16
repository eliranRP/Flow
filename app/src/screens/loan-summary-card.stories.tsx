import type { Meta, StoryObj } from "@storybook/react";
import { LoanSummaryCard } from "./loan-summary-card";
import type { LoanListSummary } from "./loan-list-summary";

/**
 * FLOW-139. The list's summary card with the board's figures in USD, on invented lenders. The
 * monthly parts are 4,477 principal, 5,062.50 interest and 643 escrow; the next payment is 1,837.50.
 */
const SUMMARY: LoanListSummary = {
  openCount: 4,
  totalBalanceMinor: 63_490_000n,
  monthlyParts: { principal: 447_700n, interest: 506_250n, escrow: 64_300n, fees: 0n },
  monthlyMinor: 1_018_250n,
  next: { loanId: "harbor", lenderName: "Harbor Lending", dueDate: "2026-11-01", amountMinor: 183_750n },
  twelveMonthsMinor: 12_219_000n,
};

// Storybook cannot serialise bigint args, so the figures stay in render.
const meta = {
  title: "Screens/Loans/Summary card",
  component: LoanSummaryCard,
} satisfies Meta<typeof LoanSummaryCard>;

export default meta;

type Story = StoryObj<typeof LoanSummaryCard>;

export const Default: Story = {
  render: () => <LoanSummaryCard summary={SUMMARY} currency="USD" />,
};

/** Only the principal is due this month: the interest and escrow parts are left out of the bar. */
export const PrincipalOnly: Story = {
  render: () => (
    <LoanSummaryCard summary={{ ...SUMMARY, monthlyParts: { principal: 447_700n, interest: 0n, escrow: 0n, fees: 0n }, monthlyMinor: 447_700n, next: null }} currency="USD" />
  ),
};
