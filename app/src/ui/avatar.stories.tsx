import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./avatar";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/Avatar",
  component: Avatar,
  decorators: [padded],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { name: "אלירן" } };
export const LongHebrew: Story = { args: { name: longHebrew } };
