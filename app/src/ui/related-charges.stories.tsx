import type { PartyCharges } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { PartyChargesBody } from "./related-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./related-charges.sample";
import { inSheet } from "./story-support";

/**
 * FLOW-366: the all-charges sheet's body (the twelve newest, with ▲/▼ marks from 20%, the current
 * line marked). Invented data only; args name a sample, since story args never hold a bigint.
 */
const samples: Record<"mailbox" | "cheaper" | "steady" | "rent", PartyCharges> = {
  mailbox: mailboxCharges,
  cheaper: cheaperCharges,
  steady: steadyCharges,
  rent: rentCharges,
};

/** The mailbox charges with one of the earlier ones still awaiting its review. */
const pendingMailbox: PartyCharges = {
  ...mailboxCharges,
  charges: mailboxCharges.charges.map((charge, index) => (index === 1 ? { ...charge, pending: true } : charge)),
};

function Demo({ sample, pending }: { sample: keyof typeof samples; pending: boolean }) {
  return <PartyChargesBody data={pending ? pendingMailbox : samples[sample]} />;
}

const meta = {
  title: "Components/RelatedCharges",
  component: Demo,
  tags: ["autodocs"],
  decorators: [inSheet],
  parameters: { sheetTitle: "Example Mailbox · כל החיובים" },
  args: { sample: "mailbox", pending: false },
  argTypes: {
    sample: { control: "select", options: ["mailbox", "cheaper", "steady", "rent"] },
    pending: { control: "boolean" },
  },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sheet's body: the change in words, the bars, then the charges with their marks. */
export const Body: Story = { name: "Sheet: the body, an expense up 92%" };
/** Money in: the amounts carry the plus and the income colour. */
export const Income: Story = { name: "Sheet: income", args: { sample: "rent" } };
/** An earlier charge still awaiting its review shows ממתין on its row. */
export const PendingRow: Story = { name: "Sheet: a pending charge", args: { pending: true } };
/** The ±20% marks: an expense down, and an expense that is near its usual amount (no mark). */
export const Marks: Story = { name: "Sheet: the marks, an expense down", args: { sample: "cheaper" } };
