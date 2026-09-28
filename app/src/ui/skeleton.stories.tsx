import type { Meta, StoryObj } from "@storybook/react";
import { HomeSkeleton, Skeleton } from "./skeleton";
import { padded } from "./story-support";

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  decorators: [padded],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bar: Story = { args: { width: "md" } };
export const Home: Story = { args: {}, render: () => <HomeSkeleton /> };
