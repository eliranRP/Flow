import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReviewHeld } from "@flow/shared";
import { expect, within } from "storybook/test";
import { ReviewCard } from "./review-card";
import { reviewHeldView } from "../review-copy";
import { padded } from "./story-support";

/**
 * FLOW-1166: a sync's change held for a line in a closed period, as the review queue draws it. Invented data.
 * Amounts are agorot or cents as digit strings (story args hold no bigint).
 */
type HeldArgs = {
  supplier: string;
  sourcePill: string;
  sourceLine: string;
  source: "mercury" | "sumit";
  amountNet: string;
  vat: string;
  currency: string;
  docDate: string;
  lineStatus: "pending" | "posted";
  held: ReviewHeld;
};

function HeldCard({ supplier, sourcePill, sourceLine, source, amountNet, vat, currency, docDate, lineStatus, held }: HeldArgs) {
  const row = { source, amount_net: BigInt(amountNet), vat_agorot: BigInt(vat), currency, doc_date: docDate, line_status: lineStatus, held };
  return (
    <ReviewCard
      supplier={supplier}
      sourceLine={sourceLine}
      sourcePill={sourcePill}
      netAgorot={row.amount_net}
      currency={currency}
      reason="closed_month_change"
      held={reviewHeldView(row)}
    />
  );
}

const meta = {
  title: "Components/ReviewCard/Held change",
  component: HeldCard,
  decorators: [padded],
} satisfies Meta<typeof HeldCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const bank = {
  supplier: "Example Supply Co",
  sourcePill: "שורת בנק",
  sourceLine: "14/03/2026 · הוצאה",
  source: "mercury",
  amountNet: "-120000",
  vat: "0",
  currency: "USD",
  docDate: "2026-03-14",
  lineStatus: "posted",
} as const;

/** The bank changed the amount of a line in a closed month. */
export const BankAmount: Story = {
  name: "Held: bank amount",
  args: {
    ...bank,
    held: { kind: "update", amount_minor: 135_050, currency: "USD", doc_date: "2026-03-14", line_status: "posted", provider: "mercury" },
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText("שינוי מהבנק ממתין: התקופה סגורה בספרים.")).toBeInTheDocument();
    await expect(card.getByText("$1,350.50")).toBeInTheDocument();
  },
};

/** The document was deleted in SUMIT. */
export const SumitRemoval: Story = {
  name: "Held: SUMIT removal",
  args: {
    supplier: "חברת הדוגמה לחומרי בניין",
    sourcePill: "חשבונית",
    sourceLine: "03/02/2026 · הוצאה",
    source: "sumit",
    amountNet: "-100000",
    vat: "-18000",
    currency: "ILS",
    docDate: "2026-02-03",
    lineStatus: "posted",
    held: { kind: "remove", provider: "sumit" },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("המסמך נמחק ב־SUMIT.")).toBeInTheDocument();
  },
};

/** A pending bank line posted in a closed month. */
export const PendingPosted: Story = {
  name: "Held: pending became posted",
  args: {
    ...bank,
    lineStatus: "pending",
    held: { kind: "update", amount_minor: 120_000, currency: "USD", doc_date: "2026-03-14", line_status: "posted", provider: "mercury" },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("השורה עברה לסופית.")).toBeInTheDocument();
  },
};

/** A new amount and a new date together, the tallest card. */
export const AmountAndDate: Story = {
  name: "Held: amount and date",
  args: {
    ...bank,
    held: { kind: "update", amount_minor: 123_456_789, currency: "USD", doc_date: "2026-03-29", line_status: "posted", provider: "mercury" },
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement);
    await expect(card.getByText("$1,234,567.89")).toBeInTheDocument();
    await expect(card.getByText("29/03/2026")).toBeInTheDocument();
  },
};
