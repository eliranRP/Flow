import type { Meta, StoryObj } from "@storybook/react";
import { TabBar, TabBarPicture } from "./tab-bar";

const meta = {
  title: "Components/TabBar",
  component: TabBar,
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** FLOW-364: the loans tab is current on the loans page. */
export const Loans: Story = { args: { section: "loans" } };

/** FLOW-506: the router-free picture the setup demos draw, on בית. */
export const Picture: Story = {
  parameters: { flowRouter: false },
  render: () => <TabBarPicture section="home" />,
};
