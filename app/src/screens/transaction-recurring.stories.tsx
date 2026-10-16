import type { PartyCharges, PaymentRecurring, TransactionDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { TxnRecurring } from "./transaction-recurring";
import { cheaperCharges, mailboxCharges, steadyCharges } from "../ui/related-charges.sample";
import { StoryRoute } from "../ui/story-route";

/**
 * FLOW-366 (Lines.dc 113–140): the recurring row, its pace sheet with לא קבוע, and the party's
 * history. Invented data only; the recurring state and the charges are passed in, not read.
 */
const txn: NonNullable<TransactionDetail> = {
  id: "t-rec",
  description: "בזק",
  direction: "expense",
  doc_date: "2026-10-04",
  amount_net: -11_990n,
  amount_gross: -11_990n,
  vat_amount: 0n,
  currency: "USD",
  source: "mercury",
  supplier_name: "בזק",
  project_name: "דירת הגפן",
  category_name: "חשבונות",
} as unknown as NonNullable<TransactionDetail>;

const recurring = (over: Partial<PaymentRecurring>): PaymentRecurring => ({
  transaction_id: "t-rec",
  party: { direction: "expense", id: "s-bezeq", name: "בזק", currency: "USD" },
  recurring: true,
  override: null,
  detected: true,
  typical_day: 4,
  typical_amount_minor: 1199n,
  pace: "month",
  detected_pace: "month",
  ...over,
});

function Demo({ state, charges }: { state: PaymentRecurring | null; charges: PartyCharges | null }) {
  return (
    <StoryRoute entry="/transactions/t-rec">
      <TxnRecurring txn={txn} holdWrites={false} sample={state} sampleCharges={charges} context="דירת הגפן · חשבונות" />
    </StoryRoute>
  );
}

const meta = {
  title: "Components/TransactionRecurring",
  component: Demo,
  parameters: { flowRouter: false, viewport: { defaultViewport: "flow390-short" } },
  tags: ["autodocs"],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The pace sheet: לא קבוע is the stored choice, and the detected note sits under the detected pace. */
export const PaceSheetOpen: Story = {
  args: { state: recurring({ recurring: false, override: false, detected: false }), charges: mailboxCharges },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /קבוע/ }));
  },
};
/** Twelve charges, the usual amount with a 27% rise that hurts (the all-charges sheet is one tap away). */
export const AllChargesSheet: Story = {
  args: { state: recurring({}), charges: mailboxCharges },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "לכל החיובים" }));
  },
};
/** Few earlier charges: no link to all of them, and the history stays short. */
export const FewCharges: Story = { args: { state: recurring({}), charges: { ...cheaperCharges, charges: cheaperCharges.charges.slice(0, 2) } } };
/** Steady charges: the change reads "כרגיל", not a percent. */
export const Flat: Story = { args: { state: recurring({}), charges: steadyCharges } };
