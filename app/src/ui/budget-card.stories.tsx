import type { Meta, StoryObj } from "@storybook/react-vite";
import { BudgetCard, BudgetEmptyCard } from "./budget-card";
import { forceReducedMotion } from "./reduced-motion";
import { padded } from "./story-support";

/** Storybook args hold no bigint, so the amounts come in as agorot numbers and convert here. */
function Budget({ spent, budget, contract = false }: { spent: number; budget: number; contract?: boolean }) {
  return <BudgetCard spentMinor={BigInt(spent)} budgetMinor={BigInt(budget)} onEdit={() => undefined} contract={contract} />;
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
/** Spend past the budget: the bar runs past a tick in the error colour, and the note names the overspend (FLOW-961). */
export const Over: Story = { args: { spent: 6_480_000, budget: 6_000_000 } };
/** FLOW-961: no budget yet, the dashed card in its place. */
export const Empty: Story = { render: () => <BudgetEmptyCard onAdd={() => undefined} /> };
/** The owner (2026-11-05): on a project page the dashed card has an X that hides it on this device. */
export const EmptyHideable: Story = { name: "Empty, hideable", render: () => <BudgetEmptyCard onAdd={() => undefined} onHide={() => undefined} /> };
/** FLOW-1044: a client project's contract, what is collected of it and what is left to collect. */
export const Contract: Story = { args: { spent: 72_000_000, budget: 100_000_000, contract: true } };
export const ReducedMotion: Story = { decorators: [forceReducedMotion] };
