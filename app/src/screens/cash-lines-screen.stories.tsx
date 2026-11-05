import type { CashLine } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { longHebrew } from "../ui/story-support";
import { LinesSkeleton } from "../ui/screen-skeletons";
import { cashMonthKey } from "../cash";
import { sampleCashLines, sampleCashLinesFlagged, sampleCashMonths } from "../dev/cash-sample";
import { LINES_ORDERS, type LinesOrder } from "../cash-lines-groups";
import { StoryRoute } from "../ui/story-route";
import { CashLinesScreen } from "./cash-lines-screen";

/** FLOW-366: the month lines page. Invented rows only; the flags the server sends are set here. */
type LinesArgs = { side: "out" | "in" | "kept"; order: LinesOrder; lines?: "plain" | "flagged" | "none" | "recurring" | "long" };

function linesFor(args: LinesArgs): CashLine[] {
  if (args.lines === "none") return [];
  if (args.lines === "flagged") return sampleCashLinesFlagged(args.side);
  // FLOW-1048: FLOW-1035's flag on every line (every other line recurring), so the recurring-or-one-off chip shows.
  if (args.lines === "recurring") return sampleCashLines(args.side).map((row, index) => ({ ...row, recurring: index % 2 === 0 }));
  if (args.lines === "long") return [0, 1, 2].flatMap((round) => sampleCashLines(args.side).map((row) => ({ ...row, transaction_id: `${row.transaction_id}-${String(round)}`, supplier_name: `${row.supplier_name ?? row.description} ${longHebrew}` })));
  return sampleCashLines(args.side);
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
    lines: { control: "select", options: ["plain", "flagged", "none", "recurring", "long"] },
  },
  render: (args) => <Lines {...args} />,
} satisfies Meta<LinesArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByDate: Story = { args: { side: "out", order: "date" } };

/** FLOW-965: lines waiting for approval are the filled review button; the count line keeps the out-of-profit part. */
export const Pending: Story = {
  args: { side: "out", order: "date", lines: "flagged" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^לאישור/ })).toBeInTheDocument();
    await expect(canvas.queryByText(/ממתינות לאישור/)).toBeNull();
    await expect(canvas.getByText(/לא נספרים ברווח/)).toBeInTheDocument();
  },
};

/** FLOW-965: offline, the lines stay and a line under the total says from when. */
export const Offline: Story = {
  render: () => {
    const data = sampleCashMonths();
    const key = cashMonthKey(data.months[0]?.month ?? "");
    return (
      <StoryRoute entry={`/cash/${key}/out/ILS`} tabs>
        <CashLinesScreen sample={{ months: data, lines: sampleCashLines("out"), offlineSince: Date.UTC(2026, 9, 26, 6, 41) }} at={{ month: key, side: "out", currency: "ILS" }} />
      </StoryRoute>
    );
  },
};

/** FLOW-965: the read failed: the figures are hidden, and the card says what did not load, with נסו שוב and צריך עזרה?. */
export const Failed: Story = {
  render: () => {
    const key = cashMonthKey(sampleCashMonths().months[0]?.month ?? "");
    return (
      <StoryRoute entry={`/cash/${key}/in/ILS?preview=error-server`} tabs>
        <CashLinesScreen at={{ month: key, side: "in", currency: "ILS" }} />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "צריך עזרה?" })).toBeInTheDocument();
  },
};

/** The compact bar shows once the chips have scrolled under the top of the screen. */
export const Scrolled: Story = {
  args: { side: "out", order: "date", lines: "flagged" },
  play: ({ canvasElement }) => {
    canvasElement.ownerDocument.defaultView?.scrollTo(0, 600);
    return Promise.resolve();
  },
};

/** FLOW-965: no line on the side: the month says so, with one way on, the other side. */
export const Empty: Story = {
  args: { side: "in", order: "date", lines: "none" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: /^מה יצא ב/ })).toBeInTheDocument();
  },
};

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

/** FLOW-1048: every line carries FLOW-1035's flag: the קבוע / חד-פעמי chip, and the two groups it orders. */
export const RecurringOrder: Story = {
  args: { side: "out", order: "recurring", lines: "recurring" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "קבוע / חד-פעמי" })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByRole("heading", { name: "קבועים" })).toBeInTheDocument();
  },
};

/** FLOW-1048: an older server sends no flag: the chip is hidden, and the page orders by date. */
export const RecurringOrderNoFlag: Story = {
  args: { side: "out", order: "recurring", lines: "plain" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("radio", { name: "קבוע / חד-פעמי" })).toBeNull();
  },
};

/** While the lines load (V3-States). */
export const Loading: Story = { render: () => <LinesSkeleton /> };

/** Long names and many lines (V3-States). */
export const LongContent: Story = { args: { side: "out", order: "date", lines: "long" } };

/** FLOW-1048: scrolled past the segment: the 56px bar comes down and the side segment docks into it. */
export const Docked: Story = {
  args: { side: "out", order: "date", lines: "long" },
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 900, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};
