import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
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
    supplier: "חברת החשמל",
    date: "21/09",
    netAgorot: -1_200_000n,
    vatLine: "לפני מע״מ",
    suggestion: <p className="t-label">חסר פרויקט</p>,
    actions: (
      <>
        <Button full>אישור</Button>
        <Button variant="secondary" full>שינוי</Button>
        <Button variant="ghost" full>דלג</Button>
      </>
    ),
  },
};
