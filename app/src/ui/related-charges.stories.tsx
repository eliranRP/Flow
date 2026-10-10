import type { Meta, StoryObj } from "@storybook/react";
import { partyChangeView } from "../party-charges";
import { ChargeChangeChip, PartyChargesBody } from "./related-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./related-charges.sample";
import { inSheet, padded, Stack } from "./story-support";

/**
 * FLOW-431 (owner's pick B, 2026-10-10): the transaction screen's "לעומת הרגיל" chip, and the
 * sheet of the party's earlier charges it opens. Invented data. Args name a sample, since story
 * args never hold a bigint.
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

function Chips() {
  return (
    <Stack>
      {Object.entries(samples).map(([key, data]) => {
        const view = partyChangeView(data);
        return view == null ? null : <ChargeChangeChip key={key} view={view} onClick={() => undefined} />;
      })}
    </Stack>
  );
}

const chips = { render: () => <Chips />, decorators: [padded] };
export const Chip: Story = { name: "Chip: up, down, usual, income down", ...chips };
export const ChipDark: Story = { name: "Chip, dark", ...chips, globals: { theme: "dark" } };
export const Chip320: Story = { name: "Chip, 320", ...chips, parameters: { viewport: { defaultViewport: "flow320" } } };

export const ExpenseUp: Story = { name: "Sheet: an expense up 92%" };
export const ExpenseUpDark: Story = { name: "Sheet: an expense up, dark", globals: { theme: "dark" } };
export const ExpenseUp320: Story = { name: "Sheet: an expense up, 320", parameters: { viewport: { defaultViewport: "flow320" } } };
export const ExpenseDown: Story = { name: "Sheet: an expense down", args: { sample: "cheaper" } };
export const AsUsual: Story = { name: "Sheet: the usual amount", args: { sample: "steady" } };
export const IncomeDown: Story = { name: "Sheet: income down 20%, this one pending", args: { sample: "rent" }, parameters: { sheetTitle: "שוכר לדוגמה" } };
