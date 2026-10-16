import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey } from "../cash";
import { sampleCashLines, sampleCashMonths } from "../dev/cash-sample";
import { StoryRoute } from "../ui/story-route";
import { CashLinesScreen } from "./cash-lines-screen";

const meta = {
  title: "Screens/Cash lines",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CashLinesOut: Story = {
  name: "Cash, the month's יצא",
  render: () => {
    const data = sampleCashMonths();
    return (
      <StoryRoute entry="/" tabs>
        <CashLinesScreen
          sample={{ months: data, lines: sampleCashLines("out") }}
          at={{ month: cashMonthKey(data.months[0]?.month ?? ""), side: "out", currency: "ILS" }}
        />
      </StoryRoute>
    );
  },
};

/** FLOW-418: the lines behind לא נספר ברווח, money in and out mixed. */
export const CashLinesKept: Story = {
  name: "Cash, the month's לא נספר ברווח",
  render: () => {
    const data = sampleCashMonths();
    return (
      <StoryRoute entry="/" tabs>
        <CashLinesScreen
          sample={{ months: data, lines: sampleCashLines("kept") }}
          at={{ month: cashMonthKey(data.months[0]?.month ?? ""), side: "kept", currency: "ILS" }}
        />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
    await expect(canvas.getByText("כסף שזז בבנק, אבל אינו הכנסה או הוצאה.")).toBeInTheDocument();
  },
};
