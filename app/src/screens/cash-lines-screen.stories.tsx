import type { CashLine } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey } from "../cash";
import { sampleCashLines, sampleCashLinesFlagged, sampleCashMonths } from "../dev/cash-sample";
import { LINES_ORDERS, type LinesOrder } from "../cash-lines-groups";
import { StoryRoute } from "../ui/story-route";
import { CashLinesScreen } from "./cash-lines-screen";

/** FLOW-366: the month lines page. Invented rows only; the flags the server sends are set here. */
type LinesArgs = { side: "out" | "in" | "kept"; order: LinesOrder; lines?: "plain" | "flagged" | "none" };

function linesFor(args: LinesArgs): CashLine[] {
  if (args.lines === "none") return [];
  return args.lines === "flagged" ? sampleCashLinesFlagged(args.side) : sampleCashLines(args.side);
}

function Lines({ side, order, lines }: LinesArgs) {
  const data = sampleCashMonths();
  const key = cashMonthKey(data.months[0]?.month ?? "");
  const search = order === "date" ? "" : `?order=${order}`;
  return (
    <StoryRoute entry={`/cash/${key}/${side}/ILS${search}`} tabs>
      <CashLinesScreen
        sample={{ months: data, lines: linesFor({ side, order, lines }) }}
        at={{ month: key, side, currency: "ILS" }}
      />
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Cash lines",
  parameters: { flowRouter: false },
  tags: ["autodocs"],
  args: { side: "out", order: "date", lines: "plain" },
  argTypes: {
    side: { control: "select", options: ["out", "in", "kept"] },
    order: { control: "select", options: [...LINES_ORDERS] },
    lines: { control: "select", options: ["plain", "flagged", "none"] },
  },
  render: (args) => <Lines {...args} />,
} satisfies Meta<LinesArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByDate: Story = { args: { side: "out", order: "date" } };
export const ByAmount: Story = { args: { side: "out", order: "amount" } };
export const ByProject: Story = { args: { side: "out", order: "project" } };
export const ByCategory: Story = { args: { side: "out", order: "category" } };
export const Income: Story = { args: { side: "in", order: "date" } };

/** The count line with its pending and out-of-profit parts, and the tag lines on the rows. */
export const Pending: Story = {
  args: { side: "out", order: "date", lines: "flagged" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/ממתינות לאישור/)).toBeInTheDocument();
    await expect(canvas.getByText(/לא נספרים ברווח/)).toBeInTheDocument();
  },
};

/** לא נספר ברווח: the cash profit leaves out, money in and out together. */
export const NotInProfit: Story = { args: { side: "kept", order: "date" } };

/** The compact bar shows once the chips have scrolled under the top of the screen. */
export const Scrolled: Story = {
  args: { side: "out", order: "date", lines: "flagged" },
  play: ({ canvasElement }) => {
    canvasElement.ownerDocument.defaultView?.scrollTo(0, 600);
    return Promise.resolve();
  },
};

export const Empty: Story = { args: { side: "out", order: "date", lines: "none" } };

/** Cash-view stories from the move (FLOW-418): the month's יצא and לא נספר ברווח lines. */
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
