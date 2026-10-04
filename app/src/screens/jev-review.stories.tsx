import type { Meta, StoryObj } from "@storybook/react";
import { JEV_REVIEW_SAMPLE, JevReviewCard } from "./jev-review-card";

const meta = {
  title: "Screens/Jev review",
  component: JevReviewCard,
  args: { connectorOn: true, prefill: JEV_REVIEW_SAMPLE },
} satisfies Meta<typeof JevReviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const light390 = { parameters: { viewport: { defaultViewport: "flow390" } } };
const dark390 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow390" } } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark320 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };

export const On: Story = { args: { connectorOn: true }, ...light390 };
export const OnDark: Story = { args: { connectorOn: true }, ...dark390 };
export const On320: Story = { args: { connectorOn: true }, ...light320 };
export const OnDark320: Story = { args: { connectorOn: true }, ...dark320 };

export const Off: Story = { args: { connectorOn: false }, ...light390 };
export const OffDark: Story = { args: { connectorOn: false }, ...dark390 };
export const Off320: Story = { args: { connectorOn: false }, ...light320 };
export const OffDark320: Story = { args: { connectorOn: false }, ...dark320 };
