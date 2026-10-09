import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "./skeleton";
import { padded } from "./story-support";

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  decorators: [padded],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bar: Story = {
  args: { width: "md" },
  tags: ["clip-no-text"],
};

/** No shine, for a storyboard frame such as the setup demos (FLOW-506). */
export const Still: Story = {
  args: { width: "md", still: true },
  tags: ["clip-no-text"],
};
