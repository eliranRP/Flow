import type { Meta, StoryObj } from "@storybook/react";
import { ReviewCard } from "./review-card";
import { padded } from "./story-support";

const meta = {
  title: "Components/ReviewCard",
  component: ReviewCard,
  decorators: [padded],
} satisfies Meta<typeof ReviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneCard: Story = {
  args: {
    supplier: "חומרי בניין השרון בע״מ",
    sourceLine: "חשבונית מצולמת · 21/09/2026",
    netAgorot: -850_000n,
    vatLine: "לפני מע״מ · מע״מ ₪1,530",
    suggestion: <p className="t-hint">הצעת AI</p>,
  },
};
