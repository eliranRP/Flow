import type { WeeklySummary } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeeklySummarySheet, type WeeklySummaryState } from "./weekly-summary-sheet";

// FLOW-517: one story per board state (board "Weekly summary", page "Ready for dev"). Invented
// figures only, in cents; in − out = profit + kept out in every one.
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
  alert: { project_id: "c0ffee00-3333-4000-8000-000000000001", name: "Oak Ridge", spent_minor: 5_824_000n, budget_minor: 5_200_000n },
  more_over_budget: 0,
};

const meta = {
  title: "Screens/WeeklySummarySheet",
  component: WeeklySummarySheet,
  parameters: { viewport: { defaultViewport: "flow390" } },
  // Summaries hold bigints, which story args cannot carry (story-args.test.ts), so each story renders its own state.
  args: { open: true, onOpenChange: () => undefined, weekStart: WEEK, state: { kind: "loading" } },
} satisfies Meta<typeof WeeklySummarySheet>;

export default meta;
type Story = StoryObj<typeof meta>;

function shown(state: WeeklySummaryState): Story["render"] {
  return (args) => <WeeklySummarySheet {...args} state={state} />;
}

/** 23 lines, 7 waiting: the alert, the counts and the review button. */
export const LinesWaiting: Story = { render: shown({ kind: "ready", summary: LINES }) };

/** No lines: $0 in muted text, the empty state and the bank connection. */
export const NoLines: Story = {
  render: shown({
    kind: "ready",
    summary: { ...LINES, lines: 0, auto_approved: 0, week_waiting: 0, waiting: 0, in_minor: 0n, out_minor: 0n, profit_minor: 0n, kept_out_minor: 0n, alert: null },
  }),
};

/** One line, approved without a tap: "הכול מאושר" instead of the button. */
export const OneLineApproved: Story = {
  render: shown({
    kind: "ready",
    summary: { ...LINES, lines: 1, auto_approved: 1, week_waiting: 0, waiting: 0, in_minor: 185_000n, out_minor: 0n, profit_minor: 185_000n, kept_out_minor: 0n, alert: null },
  }),
};

/** Three lines, one waiting, and no project over budget: the alert block is left out. */
export const ThreeLinesOneWaiting: Story = {
  render: shown({
    kind: "ready",
    summary: { ...LINES, lines: 3, auto_approved: 2, week_waiting: 1, waiting: 1, in_minor: 215_000n, out_minor: 49_800n, profit_minor: 165_200n, kept_out_minor: 0n, alert: null },
  }),
};

/** Fifty lines, twelve waiting: profit got worse (the signal pill) and two more projects are over. */
export const FiftyLines: Story = {
  render: shown({
    kind: "ready",
    summary: { ...LINES, lines: 50, auto_approved: 38, week_waiting: 12, waiting: 12, in_minor: 1_942_000n, out_minor: 3_318_000n, profit_minor: -224_000n, kept_out_minor: -1_152_000n, more_over_budget: 2 },
  }),
};

/** Loading: the skeleton blocks, after 300ms. */
export const Loading: Story = {};

/** The read failed: one line with "נסו שוב". */
export const Failed: Story = { render: shown({ kind: "error", offline: false }) };
