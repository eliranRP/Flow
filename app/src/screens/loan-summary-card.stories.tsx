import type { Meta, StoryObj } from "@storybook/react";
import { LoanSummaryCard } from "./loan-summary-card";
import { LOAN_SUMMARY_SAMPLE as SUMMARY } from "../dev/loan-summary-sample";

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
