import type { Meta, StoryObj } from "@storybook/react";
import { MissingBillsScreen, type RecurringSample } from "./missing-bills-screen";
import {
  SAMPLE_MISSING_BILLS,
  SAMPLE_MISSING_INCOME,
  SAMPLE_MISSING_USD,
  SAMPLE_RECURRING_CHANGES,
  SAMPLE_RECURRING_THIS_MONTH,
} from "../forecast-sample";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Recurring({ sample, entry = "/missing-bills" }: { sample: RecurringSample; entry?: string }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <MissingBillsScreen sample={sample} />
    </StoryRoute>
  );
}

const full: RecurringSample = {
  late: [...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD],
  arrived: SAMPLE_RECURRING_THIS_MONTH,
  changes: SAMPLE_RECURRING_CHANGES,
};

// FLOW-415 (owner 08:43Z, frame b-2): "קבועים", opened from Home's pending card. A late row and a
// change hide with ✕ or a swipe; the rest are plain.
export const MissingBills: Story = { name: "Recurring", render: () => <Recurring sample={full} /> };
export const MissingBillsDark: Story = { ...MissingBills, name: "Recurring, dark", ...dark };
export const MissingBills320: Story = { ...MissingBills, name: "Recurring, 320", ...at320 };
export const MissingBillsIncome: Story = {
  name: "Recurring, late income",
  render: () => <Recurring sample={{ ...full, late: [...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME] }} />,
};
export const MissingBillsArrivedOnly: Story = {
  name: "Recurring, all arrived",
  render: () => <Recurring sample={{ late: [], arrived: SAMPLE_RECURRING_THIS_MONTH, changes: [] }} />,
};
export const MissingBillsEmpty: Story = { name: "Recurring, empty", render: () => <Recurring sample={{ late: [] }} /> };
