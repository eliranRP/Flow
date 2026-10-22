import type { Meta, StoryObj } from "@storybook/react";
import { BookingReviewCard } from "./booking-review-card";
import type { JournalRow } from "./journal-card";
import { padded } from "./story-support";

/** FLOW-955 (board LedgerReviewCard). Jev's booking as a card in לאישור. Invented data only. */
const meta = {
  title: "Components/BookingReviewCard",
  component: BookingReviewCard,
  decorators: [padded],
} satisfies Meta<typeof BookingReviewCard>;

export default meta;
type Story = StoryObj;

const row = (key: string, name: string, type: string, amount: bigint, keptOut = false, project: string | null = "פרויקט הרצליה"): JournalRow => ({ key, name, type, project, amount, keptOut });

/** A loan received: money in that is not income ("+" in the text colour), its closing costs counted. */
export const LoanReceived: Story = {
  render: () => (
    <BookingReviewCard
      party="Example Lending"
      sourceLine="16/10 · נכנס · שורת בנק"
      amount={20_000_000n}
      currency="USD"
      moneyIn
      income={false}
      debit={[row("1", "Example Checking ••1234", "בנק", 20_000_000n, false, null), row("2", "עלויות סגירה", "הוצאה", 600_000n)]}
      credit={[row("3", "הלוואה · Example", "התחייבות", 20_600_000n, true)]}
      balanced
      editTo="/transactions/t-loan/journal"
    />
  ),
};

/** A payment out, read by a viewer: no עריכה. */
export const PaymentViewer: Story = {
  render: () => (
    <BookingReviewCard
      party="Example Mortgage"
      sourceLine="04/10 · יצא · שורת בנק"
      amount={235_000n}
      currency="USD"
      moneyIn={false}
      income={false}
      debit={[row("1", "ריבית משכנתא", "הוצאה", 140_000n), row("2", "אסקרו · מסים וביטוח", "נכס", 60_000n, true), row("3", "קרן הלוואה · קרן", "התחייבות", 35_000n, true)]}
      credit={[row("4", "Example Checking ••1234", "בנק", 235_000n, false, null)]}
      balanced
    />
  ),
};
