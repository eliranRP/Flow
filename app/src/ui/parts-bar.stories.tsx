import type { Meta, StoryObj } from "@storybook/react";
import { PartsBar } from "./parts-bar";

/** FLOW-139. A loan's parts as one bar with a legend row per non-zero part. Amounts are text here. */
const meta = {
  title: "UI/Parts bar",
  component: PartsBar,
  args: {
    parts: [
      { key: "principal", label: "קרן", weight: 447_700, color: "var(--color-accent)", amount: "$4,477" },
      { key: "interest", label: "ריבית", weight: 506_250, color: "var(--color-accent-dim)", amount: "$5,062.50" },
      { key: "escrow", label: "נאמנות (escrow)", weight: 64_300, color: "var(--color-line)", amount: "$643" },
    ],
  },
} satisfies Meta<typeof PartsBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ThreeParts: Story = {};

/** A zero part is left out of the bar and the legend. */
export const WithoutEscrow: Story = {
  args: {
    parts: [
      { key: "principal", label: "קרן", weight: 447_700, color: "var(--color-accent)", amount: "$4,477" },
      { key: "interest", label: "ריבית", weight: 506_250, color: "var(--color-accent-dim)", amount: "$5,062.50" },
      { key: "escrow", label: "נאמנות (escrow)", weight: 0, color: "var(--color-line)", amount: "$0" },
    ],
  },
};
