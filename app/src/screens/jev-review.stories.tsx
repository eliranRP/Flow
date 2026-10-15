import type { Meta, StoryObj } from "@storybook/react";
import { JEV_REVIEW_SAMPLE, JevReviewCard, JevReviewLayout } from "./jev-review-card";

const meta = {
  title: "Screens/Jev review",
  component: JevReviewCard,
  args: { connectorOn: true, prefill: JEV_REVIEW_SAMPLE },
} satisfies Meta<typeof JevReviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = { args: { connectorOn: true } };

export const Off: Story = { args: { connectorOn: false } };

/** FLOW-704: each card waiting on Jev, then settled. A card Jev fills keeps its height (the ✦ line is held). */
export const WaitAndSettle: Story = { render: () => <JevReviewLayout /> };
