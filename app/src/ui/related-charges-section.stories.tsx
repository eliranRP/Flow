import type { Meta, StoryObj } from "@storybook/react";
import { PartyChargesHistory } from "./related-charges";
import { cheaperCharges, mailboxCharges, rentCharges, steadyCharges } from "./related-charges.sample";

/**
 * FLOW-366: the history block under the recurring row: the usual amount and the change, the bars,
 * the three latest earlier charges and "לכל החיובים". Invented data only. Args name a sample.
 */
const samples = { mailbox: mailboxCharges, cheaper: cheaperCharges, steady: steadyCharges, rent: rentCharges };

function Demo({ sample }: { sample: keyof typeof samples }) {
  return <PartyChargesHistory data={samples[sample]} onShowAll={() => undefined} />;
}

const meta = {
  title: "Components/RelatedChargesSection",
  component: Demo,
  tags: ["autodocs"],
  args: { sample: "mailbox" },
  argTypes: { sample: { control: "select", options: ["mailbox", "cheaper", "steady", "rent"] } },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An expense up 92%: the change is in the signal colour. */
export const Hurts: Story = { name: "An expense up 92%" };
/** An expense down: the change is not in the signal colour. */
export const Good: Story = { name: "An expense down", args: { sample: "cheaper" } };
/** The usual amount: the change reads כרגיל. */
export const Flat: Story = { name: "The usual amount", args: { sample: "steady" } };
/** Income down 20%: the signal colour, since income falling hurts. */
export const Income: Story = { name: "Income down 20%", args: { sample: "rent" } };
