import type { Meta, StoryObj } from "@storybook/react";
import { BigNumber, Money, type AmountPresentation } from "./big-number";
import { largeAgorot, padded } from "./story-support";

/** Agorot travel as decimal strings. The manager JSON.stringifies args, and a bigint blanks it. */
type AmountArgs = {
  agorot: string;
  presentation?: AmountPresentation;
  size?: "hero" | "display" | "list";
  loss?: boolean;
};

function AmountView({ agorot, presentation, size, loss }: AmountArgs) {
  return <BigNumber agorot={BigInt(agorot)} presentation={presentation} size={size} loss={loss} />;
}

const meta = {
  title: "Components/BigNumber",
  component: AmountView,
  decorators: [padded],
} satisfies Meta<typeof AmountView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Summary: Story = { args: { agorot: "-7630000", size: "hero" } };
export const DetailAgorot: Story = { args: { agorot: "-10050", presentation: "detail", size: "display" } };
export const Loss: Story = { args: { agorot: "-2940000", loss: true, size: "list" } };
export const LargeAmount: Story = { args: { agorot: String(largeAgorot), size: "hero" } };
export const Inline: Story = {
  args: { agorot: "47200000" },
  render: () => <Money agorot={47_200_000n} />,
};
