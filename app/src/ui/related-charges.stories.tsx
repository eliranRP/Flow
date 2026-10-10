import type { Meta, StoryObj } from "@storybook/react";
import { PartyChargesBody } from "./related-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./related-charges.sample";
import { inSheet } from "./story-support";

/**
 * FLOW-431 (the owner's layout A, 2026-10-10): the sheet with all the party's charges that
 * "לכל החיובים" opens; the section itself is in related-charges-section.stories. Invented data.
 * Args name a sample, since story args never hold a bigint.
 */
const samples = { mailbox: mailboxCharges, cheaper: cheaperCharges, steady: steadyCharges, rent: rentCharges };

function Demo({ sample }: { sample: keyof typeof samples }) {
  return <PartyChargesBody data={samples[sample]} />;
}

const meta = {
  title: "Components/RelatedCharges",
  component: Demo,
  decorators: [inSheet],
  parameters: { sheetTitle: "Example Mailbox" },
  args: { sample: "mailbox" },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExpenseUp: Story = { name: "Sheet: an expense up 92%" };
export const ExpenseUpDark: Story = { name: "Sheet: an expense up, dark", globals: { theme: "dark" } };
export const ExpenseUp320: Story = { name: "Sheet: an expense up, 320", parameters: { viewport: { defaultViewport: "flow320" } } };
export const ExpenseDown: Story = { name: "Sheet: an expense down", args: { sample: "cheaper" } };
export const AsUsual: Story = { name: "Sheet: the usual amount", args: { sample: "steady" } };
export const IncomeDown: Story = { name: "Sheet: income down 20%, this one pending", args: { sample: "rent" }, parameters: { sheetTitle: "שוכר לדוגמה" } };
