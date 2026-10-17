import type { Meta, StoryObj } from "@storybook/react";
import { BudgetCard } from "./budget-card";
import { forceReducedMotion } from "./reduced-motion";
import { padded } from "./story-support";

/** Storybook args hold no bigint, so the amounts come in as agorot numbers and convert here. */
function Budget({ spent, budget }: { spent: number; budget: number }) {
  return <BudgetCard spentMinor={BigInt(spent)} budgetMinor={BigInt(budget)} onEdit={() => undefined} />;
}

const meta = {
  title: "Components/BudgetCard",
  component: Budget,
  decorators: [padded],
  args: { spent: 4_250_000, budget: 6_000_000 },
} satisfies Meta<typeof Budget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Spend past the budget: the bar turns signal and the note names the overspend. */
export const Over: Story = { args: { spent: 6_480_000, budget: 6_000_000 } };
/** A budget of zero shows an empty bar and no percentage. */
export const Zero: Story = { args: { spent: 0, budget: 0 } };
export const ReducedMotion: Story = { decorators: [forceReducedMotion] };
