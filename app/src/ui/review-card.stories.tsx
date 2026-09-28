import type { Meta, StoryObj } from "@storybook/react";
import { ReviewCard } from "./review-card";
import { padded } from "./story-support";

type CardArgs = {
  supplier: string;
  sourceLine: string;
  netAgorot: string;
  vatLine: string;
};

function CardView({ supplier, sourceLine, netAgorot, vatLine }: CardArgs) {
  return (
    <ReviewCard
      supplier={supplier}
      sourceLine={sourceLine}
      netAgorot={BigInt(netAgorot)}
      vatLine={vatLine}
      suggestion={<p className="t-hint">הצעת AI</p>}
    />
  );
}

const meta = {
  title: "Components/ReviewCard",
  component: CardView,
  decorators: [padded],
} satisfies Meta<typeof CardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneCard: Story = {
  args: {
    supplier: "חומרי בניין השרון בע״מ",
    sourceLine: "חשבונית מצולמת · 21/09/2026",
    netAgorot: "-850000",
    vatLine: "לפני מע״מ · מע״מ ₪1,530",
  },
};
