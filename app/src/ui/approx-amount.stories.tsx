import type { Meta, StoryObj } from "@storybook/react";
import { ApproxAmount } from "./approx-amount";
import { largeAgorot, padded } from "./story-support";

const meta = {
  title: "Components/ApproxAmount",
  component: ApproxAmount,
  decorators: [padded],
} satisfies Meta<typeof ApproxAmount>;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403. An expected figure: "כ־" and whole units, never read as an actual.
export const Ils: Story = { name: "ILS", args: { minor: 185_000n } };
export const Usd: Story = { name: "USD", args: { minor: 2_000n, currency: "USD" } };
export const Income: Story = { args: { minor: 1_200_000n, income: true } };
export const Zero: Story = { args: { minor: 0n } };
export const Dark: Story = { args: { minor: 185_000n }, globals: { theme: "dark" } };
export const LargeAmount: Story = {
  name: "Large Amount",
  args: { minor: largeAgorot },
  parameters: { viewport: { defaultViewport: "flow320" } },
};
