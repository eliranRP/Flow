import type { Meta, StoryObj } from "@storybook/react";
import { partyChangeView } from "../party-charges";
import { ChargeChangeChip, PartyChargesBody } from "./related-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./related-charges.sample";
import { inSheet, padded, Stack } from "./story-support";

/**
 * FLOW-431 (owner's pick B, 2026-10-10): the transaction screen's "לעומת הרגיל" chip, and the
 * sheet of the party's earlier charges it opens. Invented data.
 */
const meta = {
  title: "Components/RelatedCharges",
  component: PartyChargesBody,
  decorators: [inSheet],
  parameters: { sheetTitle: "Example Mailbox" },
} satisfies Meta<typeof PartyChargesBody>;

export default meta;
type Story = StoryObj<typeof meta>;

function Chips() {
  return (
    <Stack>
      {[mailboxCharges, cheaperCharges, steadyCharges, rentCharges].map((data) => {
        const view = partyChangeView(data);
        return view == null ? null : <ChargeChangeChip key={`${data.transaction_id}-${String(data.change_percent)}`} view={view} onClick={() => undefined} />;
      })}
    </Stack>
  );
}

const chips = { render: () => <Chips />, decorators: [padded] };
export const Chip: Story = { name: "Chip: up, down, usual, income down", args: { data: mailboxCharges }, ...chips };
export const ChipDark: Story = { name: "Chip, dark", args: { data: mailboxCharges }, ...chips, globals: { theme: "dark" } };
export const Chip320: Story = { name: "Chip, 320", args: { data: mailboxCharges }, ...chips, parameters: { viewport: { defaultViewport: "flow320" } } };

export const ExpenseUp: Story = { name: "Sheet: an expense up 92%", args: { data: mailboxCharges } };
export const ExpenseUpDark: Story = { name: "Sheet: an expense up, dark", args: { data: mailboxCharges }, globals: { theme: "dark" } };
export const ExpenseUp320: Story = { name: "Sheet: an expense up, 320", args: { data: mailboxCharges }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const ExpenseDown: Story = { name: "Sheet: an expense down", args: { data: cheaperCharges } };
export const AsUsual: Story = { name: "Sheet: the usual amount", args: { data: steadyCharges } };
export const IncomeDown: Story = { name: "Sheet: income down 20%, this one pending", args: { data: rentCharges }, parameters: { sheetTitle: "שוכר לדוגמה" } };
