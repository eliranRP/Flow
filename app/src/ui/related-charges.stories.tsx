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

function Demo({ sample }: { sample: keyof typeof samples }) {
  return <PartyChargesBody data={samples[sample]} />;
}

const meta = {
  title: "Components/RelatedCharges",
  component: Demo,
  tags: ["autodocs"],
  decorators: [inSheet],
  parameters: { sheetTitle: "Example Mailbox · כל החיובים" },
  args: { sample: "mailbox" },
  argTypes: {
    sample: { control: "select", options: ["mailbox", "cheaper", "steady", "rent"] },
  },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sheet's body: the change in words, the bars, then the charges with their marks. */
export const Body: Story = { name: "Sheet: the body, an expense up 92%" };
/** Money in: the amounts carry the plus and the income colour. */
export const Income: Story = { name: "Sheet: income", args: { sample: "rent" } };
