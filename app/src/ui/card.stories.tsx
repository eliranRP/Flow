import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./card";
import { padded } from "./story-support";

const meta = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
  decorators: [padded],
  args: {
    tone: "default",
    children: <p className="t-meta">הוצאות החודש: 4,200 ₪ מתוך 6,000 ₪</p>,
  },
  argTypes: {
    tone: { control: "select", options: ["default", "tint"] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Tint: Story = { args: { tone: "tint" } };
