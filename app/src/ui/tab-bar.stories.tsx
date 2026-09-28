import type { Meta, StoryObj } from "@storybook/react";
import { TabBar } from "./tab-bar";

const meta = {
  title: "Components/TabBar",
  component: TabBar,
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { reviewCount: 0 } };
export const Pending: Story = { args: { reviewCount: 7 } };
export const LargeCount: Story = { args: { reviewCount: 100 } };
