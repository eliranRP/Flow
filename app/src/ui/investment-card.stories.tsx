import type { Meta, StoryObj } from "@storybook/react";
import { InvestmentCard } from "./investment-card";
import { EMPTY, FILLED, MISSING, OTHER_CURRENCY, UNDER_WATER } from "./investment-card.stories-support";

const FIGURES = { filled: FILLED, missing: MISSING, empty: EMPTY, other: OTHER_CURRENCY, under: UNDER_WATER };

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
      onLoans={() => undefined}
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

const dark = { globals: { theme: "dark" } };
const w320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const Filled: Story = {};
export const FilledDark: Story = { ...dark };
export const Filled320: Story = { ...w320 };
export const Missing: Story = { args: { figures: "missing" } };
export const MissingDark: Story = { args: { figures: "missing" }, ...dark };
export const Missing320: Story = { args: { figures: "missing" }, ...w320 };
export const Empty: Story = { args: { figures: "empty" } };
export const OtherCurrency: Story = { args: { figures: "other" } };
export const OtherCurrency320: Story = { args: { figures: "other" }, ...w320 };
export const UnderWater: Story = { args: { figures: "under" } };
export const Viewer: Story = { args: { figures: "missing", readOnly: true } };
export const ViewerDark: Story = { args: { figures: "missing", readOnly: true }, ...dark };
export const Loading: Story = { args: { state: "loading" } };
export const LoadError: Story = { name: "Error", args: { state: "error" } };
export const LoadErrorDark: Story = { name: "Error dark", args: { state: "error" }, ...dark };
