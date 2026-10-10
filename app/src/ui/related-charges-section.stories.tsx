import type { Meta, StoryObj } from "@storybook/react";
import { PartyChargesSection } from "./related-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./related-charges.sample";

/**
 * FLOW-431 (the owner's layout A, 2026-10-10): "חיובים קודמים" under the transaction's switches.
 * Invented data. Args name a sample, since story args never hold a bigint.
 */
const samples = { mailbox: mailboxCharges, cheaper: cheaperCharges, steady: steadyCharges, rent: rentCharges };

function Demo({ sample }: { sample: keyof typeof samples }) {
  return <PartyChargesSection data={samples[sample]} onShowAll={() => undefined} />;
}

const meta = {
  title: "Components/RelatedChargesSection",
  component: Demo,
  args: { sample: "mailbox" },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExpenseUp: Story = { name: "An expense up 92%" };
export const ExpenseUpDark: Story = { name: "An expense up, dark", globals: { theme: "dark" } };
export const ExpenseUp320: Story = { name: "An expense up, 320", parameters: { viewport: { defaultViewport: "flow320" } } };
export const ExpenseDown: Story = { name: "An expense down", args: { sample: "cheaper" } };
export const AsUsual: Story = { name: "The usual amount", args: { sample: "steady" } };
export const IncomeDown: Story = { name: "Income down 20%", args: { sample: "rent" } };
