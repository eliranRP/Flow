import type { Meta, StoryObj } from "@storybook/react";
import { TabBar } from "./tab-bar";

const meta = {
  title: "Components/TabBar",
  component: TabBar,
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** FLOW-364: the loans tab is current on the loans page. */
export const Loans: Story = { args: { section: "loans" } };
