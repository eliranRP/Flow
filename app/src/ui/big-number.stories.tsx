import type { Meta, StoryObj } from "@storybook/react";
import { BigNumber, Money } from "./big-number";
import { largeAgorot, padded } from "./story-support";

const meta = {
  title: "Components/BigNumber",
  component: BigNumber,
  decorators: [padded],
} satisfies Meta<typeof BigNumber>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Summary: Story = { args: { agorot: -7_630_000n, size: "hero" } };
export const DetailAgorot: Story = { args: { agorot: -10_050n, presentation: "detail", size: "display" } };
export const Loss: Story = { args: { agorot: -2_940_000n, loss: true, size: "list" } };
export const LargeAmount: Story = { args: { agorot: largeAgorot, size: "hero" } };
export const Inline: Story = {
  args: { agorot: 47_200_000n },
  render: () => <Money agorot={47_200_000n} />,
};
