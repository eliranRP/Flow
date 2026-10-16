import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./avatar";

// The board's neutral circle: 36px, the avatar fill and secondary text in both themes (FLOW-445).

const meta = {
  title: "Components/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  args: { name: "Halvorsen", fallback: "person" },
  argTypes: {
    fallback: { control: "select", options: ["bank", "invoice", "person"] },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Letters: Story = {};

export const TwoWords: Story = {
  args: { name: "Oak Ridge" },
};

/** A name with no letter shows the source icon in the same circle. */
export const IconFallback: Story = {
  args: { name: "", fallback: "bank" },
};
