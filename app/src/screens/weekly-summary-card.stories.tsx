import type { WeeklySummary } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeeklySummaryCard } from "./weekly-summary-card";

// FLOW-956: one story per board look (board "Weekly card on Home", page "Ready for dev"). Invented
// figures only, in cents.
const WEEK = "2026-10-04";

const LINES: WeeklySummary = {
  week_start: WEEK,
  currency: "USD",
  lines: 23,
  auto_approved: 16,
  week_waiting: 7,
  waiting: 7,
  in_minor: 1_432_000n,
  out_minor: 2_190_500n,
  profit_minor: -121_000n,
  kept_out_minor: -637_500n,
  prev_profit_minor: -205_000n,
  alert: null,
  more_over_budget: 0,
};

const meta = {
  title: "Screens/WeeklySummaryCard",
  component: WeeklySummaryCard,
  parameters: { viewport: { defaultViewport: "flow390" } },
  // Summaries hold bigints, which story args cannot carry (story-args.test.ts), so each story renders its own.
  args: { weekStart: WEEK, onOpen: () => undefined, onHide: () => undefined, summary: undefined as unknown as WeeklySummary },
} satisfies Meta<typeof WeeklySummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

function shown(summary: WeeklySummary): Story["render"] {
  return (args) => <WeeklySummaryCard {...args} summary={summary} />;
}

/** 7 waiting: the profit in the signal colour and "7 מחכות לאישור" in the accent text. */
export const Waiting: Story = { render: shown(LINES) };

/** Nothing waits: "✓ הכול מאושר". */
export const AllApproved: Story = {
  render: shown({ ...LINES, lines: 1, auto_approved: 1, week_waiting: 0, waiting: 0, in_minor: 185_000n, out_minor: 0n, profit_minor: 185_000n, kept_out_minor: 0n }),
};

/** No lines that week: $0 muted and "לא נכנסו תנועות". */
export const NoLines: Story = {
  render: shown({ ...LINES, lines: 0, auto_approved: 0, week_waiting: 0, waiting: 0, in_minor: 0n, out_minor: 0n, profit_minor: 0n, kept_out_minor: 0n }),
};
