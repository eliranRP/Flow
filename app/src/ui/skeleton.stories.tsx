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

export const Bar: Story = { args: { width: "md" } };
