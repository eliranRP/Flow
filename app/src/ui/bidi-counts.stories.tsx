import type { Meta, StoryObj } from "@storybook/react";
import { BudgetBar } from "./progress-bar";
import { padded } from "./story-support";

function Counts() {
  return (
    <div>
      <p data-bidi="projects">
        <span>עוד</span> <bdi dir="ltr">2</bdi> <span>שהסתיימו</span>
      </p>
      <p data-bidi="queue">
        <bdi dir="ltr">1</bdi> <span>מתוך</span> <bdi dir="ltr">7</bdi>
      </p>
      <BudgetBar label="טק-ליין" spentAgorot={4_000_000n} budgetAgorot={10_000_000n} />
    </div>
  );
}

const meta = {
  title: "Components/BidiCounts",
  component: Counts,
  decorators: [padded],
} satisfies Meta<typeof Counts>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadingOrder: Story = {};
