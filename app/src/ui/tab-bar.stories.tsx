import type { Meta, StoryObj } from "@storybook/react";
import { TabBar, TabBarPicture } from "./tab-bar";

const meta = {
  title: "Components/TabBar",
  component: TabBar,
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { reviewCount: 0 } };
export const Pending: Story = { args: { reviewCount: 7 } };
export const LargeCount: Story = { args: { reviewCount: 100 } };

/** FLOW-506: the router-free picture the setup demos draw, on לאישור. */
export const Picture: Story = {
  args: { reviewCount: 12 },
  parameters: { flowRouter: false },
  render: (args) => <TabBarPicture section="review" reviewCount={args.reviewCount} />,
};
