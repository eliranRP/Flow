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
  description: "ספק לדוגמה",
  direction: "expense",
  doc_date: "2026-10-04",
  amount_net: -11_990n,
  amount_gross: -11_990n,
  vat_amount: 0n,
  currency: "USD",
  source: "mercury",
  supplier_name: "ספק לדוגמה",
  project_name: "דירת הגפן",
  category_name: "חשבונות",
} as unknown as NonNullable<TransactionDetail>;

const recurring = (over: Partial<PaymentRecurring>): PaymentRecurring => ({
  transaction_id: "t-rec",
  party: { direction: "expense", id: "s-sample", name: "ספק לדוגמה", currency: "USD" },
  recurring: true,
  override: null,
  detected: true,
  typical_day: 4,
  typical_amount_minor: 1199n,
  pace: "month",
  detected_pace: "month",
  ...over,
});

/** Story args name a sample (a string), so no bigint is held in args; the data is built here. */
const stateSamples: Record<"off" | "found", PaymentRecurring> = {
  off: recurring({ recurring: false, override: false, detected: false }),
  found: recurring({}),
};
const chargeSamples: Record<"mailbox" | "few" | "steady", PartyCharges> = {
  mailbox: mailboxCharges,
  few: { ...cheaperCharges, charges: cheaperCharges.charges.slice(0, 2) },
  steady: steadyCharges,
};

function Demo({ state, charges }: { state: keyof typeof stateSamples; charges: keyof typeof chargeSamples }) {
  return (
    <StoryRoute entry="/transactions/t-rec">
      <TxnRecurring txn={txn} holdWrites={false} sample={stateSamples[state]} sampleCharges={chargeSamples[charges]} context="דירת הגפן · חשבונות" />
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
  args: { state: "off", charges: "mailbox" },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /קבוע/ }));
  },
};
/** Twelve charges, the usual amount with a 27% rise that hurts (the all-charges sheet is one tap away). */
export const AllChargesSheet: Story = {
  args: { state: "found", charges: "mailbox" },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "לכל החיובים" }));
  },
};
/** Few earlier charges: no link to all of them, and the history stays short. */
export const FewCharges: Story = { args: { state: "found", charges: "few" } };
/** Steady charges: the change reads "כרגיל", not a percent. */
export const Flat: Story = { args: { state: "found", charges: "steady" } };
