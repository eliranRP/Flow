import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListSkeleton, Skeleton } from "./skeleton";
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

/** FLOW-371: a list loading. In the app the rows wait 300ms before they show; the story draws them at once. */
export const ListLoading: Story = {
  args: { width: "md" },
  render: () => <ListSkeleton />,
  tags: ["clip-no-text"],
};
