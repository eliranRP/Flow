import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { LoanMatchOffer } from "./loan-match";

/**
 * FLOW-114 option B. An unmatched loan payment offers "שיוך להלוואה" under the category row;
 * a matched one is the category row itself (Screens/Routes, "Loan payment matched").
 * Invented loans and amounts.
 */
const LOANS = [
  {
    id: "loan-1",
    name: "משכנתא לדוגמה",
    currency: "USD",
    principalMinor: 10_000_000,
    annualRatePpm: 60_000,
    termMonths: 360,
    startDate: "2026-02-01",
    paymentMinor: 59_955,
    escrowMinor: 0,
    balanceMinor: 9_000_000n,
  },
  {
    id: "loan-2",
    name: "הלוואה שנפרעה",
    currency: "USD",
    principalMinor: 1_000_000,
    annualRatePpm: 60_000,
    termMonths: 12,
    startDate: "2025-02-01",
    paymentMinor: 86_066,
    escrowMinor: 0,
    balanceMinor: 0n,
  },
] as const;

/** Args stay plain JSON: Storybook cannot serialise bigint amounts, so stories pick loans by count. */
type OfferArgs = Partial<Omit<ComponentProps<typeof LoanMatchOffer>, "loans">> & { loanCount?: 1 | 2; open?: boolean };

function Offer({ loanCount = 1, open: startOpen = false, ...props }: OfferArgs) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <LoanMatchOffer
        lineCurrency="USD"
        loans={LOANS.slice(0, loanCount)}
        busy={false}
        matchHint={loanCount === 1 ? LOANS[0].name : undefined}
        sheetOpen={open}
        onSheetOpenChange={setOpen}
        onMatch={() => undefined}
        {...props}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Loan match",
  component: Offer,
} satisfies Meta<typeof Offer>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark390 = { globals: { theme: "dark" } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const MatchRow: Story = {};
export const MatchRowDark: Story = { ...dark390 };
export const MatchRow320: Story = { ...light320 };
/** Two loans: the picker lists both; the paid-off one is off with its reason. */
export const Picker: Story = { args: { loanCount: 2, open: true } };
/** FLOW-115: the only loans are in another currency, so the sheet names the line's currency. */
export const PickerOtherCurrency: Story = { args: { lineCurrency: "ILS", open: true } };
export const PickerOtherCurrency320Dark: Story = { args: { lineCurrency: "ILS", open: true }, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const PickerSaving: Story = { args: { loanCount: 2, open: true, savingId: "loan-1" } };
