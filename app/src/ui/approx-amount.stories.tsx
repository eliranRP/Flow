import type { Meta, StoryObj } from "@storybook/react";
import { ApproxAmount } from "./approx-amount";
import { largeAgorot, padded } from "./story-support";

// Amounts are bigint, so they stay in render: story args go through JSON.
const meta = {
  title: "Components/ApproxAmount",
  decorators: [padded],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403. An expected figure: "כ־" and whole units, never read as an actual.
export const Ils: Story = { name: "ILS", render: () => <ApproxAmount minor={185_000n} /> };
export const Usd: Story = { name: "USD", render: () => <ApproxAmount minor={2_000n} currency="USD" /> };
export const Income: Story = { render: () => <ApproxAmount minor={1_200_000n} income /> };
export const Zero: Story = { render: () => <ApproxAmount minor={0n} /> };
export const Dark: Story = { render: () => <ApproxAmount minor={185_000n} />, globals: { theme: "dark" } };
export const LargeAmount: Story = {
  name: "Large Amount",
  render: () => <ApproxAmount minor={largeAgorot} />,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
