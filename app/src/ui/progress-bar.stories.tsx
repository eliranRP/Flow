import type { Meta, StoryObj } from "@storybook/react";
import { BudgetBar, ProgressBar } from "./progress-bar";
import { largeAgorot, longHebrew, padded, Stack } from "./story-support";

const meta = {
  title: "Components/ProgressBar",
  component: ProgressBar,
  decorators: [padded],
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { value: 0, label: "התקדמות" } };
export const Mid: Story = { args: { value: 42, label: "התקדמות" } };
export const Full: Story = { args: { value: 100, label: "התקדמות" } };
export const LongHebrew: Story = { args: { value: 64, label: longHebrew } };
export const Budget: Story = {
  args: { value: 40, label: "תקציב" },
  render: () => <BudgetBar label="טק-ליין" spentAgorot={4_000_000n} budgetAgorot={10_000_000n} />,
};
export const OverBudget: Story = {
  args: { value: 100, label: "תקציב" },
  render: () => <BudgetBar label="טק-ליין" spentAgorot={12_000_000n} budgetAgorot={10_000_000n} />,
};
export const LargeAmount: Story = {
  args: { value: 80, label: "תקציב" },
  render: () => (
    <Stack>
      <BudgetBar label={longHebrew} spentAgorot={largeAgorot} budgetAgorot={largeAgorot + 1_000_000n} />
    </Stack>
  ),
};
