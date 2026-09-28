import type { Meta, StoryObj } from "@storybook/react";
import { FigureLine } from "./layout";
import { padded } from "./story-support";

const meta = {
  title: "Components/FigureLine",
  component: FigureLine,
  decorators: [padded],
} satisfies Meta<typeof FigureLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Income: Story = { args: { label: "הכנסות", value: "₪180,000" } };
export const Expense: Story = { args: { label: "הוצאות ישירות", value: "−₪90,000" } };
