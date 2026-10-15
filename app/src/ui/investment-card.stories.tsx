import type { Meta, StoryObj } from "@storybook/react";
import { InvestmentCard } from "./investment-card";
import { EMPTY, FILLED, MISSING, OTHER_CURRENCY, UNDER_WATER } from "./investment-card.stories-support";

const FIGURES = { filled: FILLED, missing: MISSING, empty: EMPTY, other: OTHER_CURRENCY, under: UNDER_WATER };

/** Matches the screen: no loans in any currency means a static row. */
function hasLoans(f: (typeof FIGURES)[keyof typeof FIGURES]): boolean {
  return f.loanMinor !== 0n || f.loanOther.length > 0;
}

/** Story args stay plain (no bigint): the figures are picked by name. */
function Card({
  figures = "filled",
  state = "ready",
  readOnly = false,
}: {
  figures?: keyof typeof FIGURES;
  state?: "ready" | "loading" | "error";
  readOnly?: boolean;
}) {
  return (
    <InvestmentCard
      state={state}
      figures={state === "ready" ? FIGURES[figures] : null}
      readOnly={readOnly}
      onEdit={() => undefined}
      onRehab={() => undefined}
      onLoans={hasLoans(FIGURES[figures]) ? () => undefined : undefined}
      onRetry={() => undefined}
    />
  );
}

const meta = {
  title: "Components/InvestmentCard",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;


export const Filled: Story = {};
export const Missing: Story = { args: { figures: "missing" } };
export const Empty: Story = { args: { figures: "empty" } };
export const OtherCurrency: Story = { args: { figures: "other" } };
export const UnderWater: Story = { args: { figures: "under" } };
export const Viewer: Story = { args: { figures: "missing", readOnly: true } };
export const Loading: Story = { args: { state: "loading" } };
export const LoadError: Story = { name: "Error", args: { state: "error" } };
