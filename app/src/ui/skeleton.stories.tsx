import type { Meta, StoryObj } from "@storybook/react";
import { HomeSkeleton, Loader, Skeleton } from "./skeleton";
import { padded } from "./story-support";

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  decorators: [padded],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bar: Story = { args: { className: "home-skel-row" } };
export const Loading: Story = { args: {}, render: () => <Loader /> };
export const LoadingLong: Story = { args: {}, render: () => <Loader label="טוען את התנועות של החודש, כולל חשבוניות שעוד לא שולמו…" /> };
export const Home: Story = { args: {}, render: () => <HomeSkeleton /> };
export const HomePreview: Story = { args: {}, render: () => <HomeSkeleton previewing /> };
