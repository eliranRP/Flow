import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { LoanMatchOffer, LoanMatchSkeleton, loanMatchHint } from "./loan-match";

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
        matchHint={loanMatchHint(LOANS.slice(0, loanCount), props.lineCurrency ?? "USD")}
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
/** FLOW-115: two loans in the line's currency; the hint counts them, so the row keeps its height. */
export const MatchRowTwoLoans: Story = { args: { loanCount: 2 } };
/** FLOW-115: no loan in the line's currency; the hint says so in the sheet's words. */
export const MatchRowNoLoanInCurrency: Story = { args: { lineCurrency: "ILS" } };
/** FLOW-115: a long loan name stays on one line, so the row keeps its height. */
export const MatchRowLongName: Story = { args: { matchHint: "משכנתא ארוכה מאוד מבנק לדוגמה על הנכס ברחוב הארוך ביותר בעיר, 320" }, ...light320 };
/** FLOW-115: the row while the loans load. Same height as the rows above. */
export const MatchRowLoading: StoryObj = { render: () => <LoanMatchSkeleton /> };
/** Two loans: the picker lists both; the paid-off one is off with its reason. */
export const Picker: Story = { args: { loanCount: 2, open: true } };
/** FLOW-115: the only loans are in another currency, so the sheet names the line's currency. */
export const PickerOtherCurrency: Story = { args: { lineCurrency: "ILS", open: true } };
export const PickerOtherCurrency320Dark: Story = { args: { lineCurrency: "ILS", open: true }, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const PickerSaving: Story = { args: { loanCount: 2, open: true, savingId: "loan-1" } };

/**
 * FLOW-106 §3.4: each loan says what one tap writes. A schedule row, a catch-up of several rows, a
 * demand loan's accrued interest, and a loan closed before the line's date (off, with the day).
 */
const KIND_LOANS = [
  { ...LOANS[0], id: "k-1", name: "משכנתא לדוגמה" },
  { ...LOANS[0], id: "k-2", name: "הלוואת שיפוץ לדוגמה" },
  { ...LOANS[0], id: "k-3", name: "הלוואה לפי דרישה", kind: "demand" as const, termMonths: null, paymentMinor: null },
  { ...LOANS[0], id: "k-4", name: "הלוואה שנסגרה", status: "closed" as const, closedOn: "2025-11-30" },
];
const KIND_OFFERS = [
  { loanId: "k-1", description: "לפי הלוח · $599.55", parts: [] },
  { loanId: "k-2", description: "3 תשלומים לפי הלוח · $1,798.65", parts: [] },
  { loanId: "k-3", description: "ריבית צבורה $328.77 · השאר לקרן", parts: [] },
  { loanId: "k-4", disabledReason: "נסגרה ב־30/11/2025", parts: null },
];

function KindsPicker() {
  const [open, setOpen] = useState(true);
  return (
    <LoanMatchOffer
      lineCurrency="USD"
      loans={KIND_LOANS}
      offers={KIND_OFFERS}
      busy={false}
      matchHint="4 הלוואות"
      sheetOpen={open}
      onSheetOpenChange={setOpen}
      onMatch={() => undefined}
    />
  );
}

export const PickerKinds: StoryObj = { render: () => <KindsPicker /> };
export const PickerKindsDark: StoryObj = { render: () => <KindsPicker />, ...dark390 };
export const PickerKinds320: StoryObj = { render: () => <KindsPicker />, ...light320 };
