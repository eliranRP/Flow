import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SegmentedControl } from "./segmented-control";
import { longHebrew, padded } from "./story-support";

function Demo({ value, long = false }: { value: "expenses" | "income"; long?: boolean }) {
  const [current, setCurrent] = useState(value);
  return (
    <SegmentedControl
      label="תצוגה"
      value={current}
      onChange={setCurrent}
      options={
        long
          ? [
              { value: "expenses", label: longHebrew },
              { value: "income", label: "הכנסות" },
            ]
          : [
              { value: "expenses", label: "הוצאות" },
              { value: "income", label: "הכנסות" },
            ]
      }
    />
  );
}

const meta = {
  title: "Components/SegmentedControl",
  component: SegmentedControl,
  decorators: [padded],
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expenses: Story = {
  args: {
    label: "תצוגה",
    value: "expenses",
    onChange: () => undefined,
    options: [
      { value: "expenses", label: "הוצאות" },
      { value: "income", label: "הכנסות" },
    ],
  },
  render: () => <Demo value="expenses" />,
};
export const Income: Story = {
  args: {
    label: "תצוגה",
    value: "income",
    onChange: () => undefined,
    options: [
      { value: "expenses", label: "הוצאות" },
      { value: "income", label: "הכנסות" },
    ],
  },
  render: () => <Demo value="income" />,
};
export const LongHebrew: Story = {
  args: {
    label: longHebrew,
    value: "expenses",
    onChange: () => undefined,
    options: [
      { value: "expenses", label: longHebrew },
      { value: "income", label: "הכנסות" },
    ],
  },
  render: () => <Demo value="expenses" long />,
};

/** The period bar's presets on the violet band (decision 0141). Under 360px 3 and 6 months shorten. */
function BandDemo() {
  const [current, setCurrent] = useState<"month" | "months3" | "months6" | "year" | "all">("months3");
  return (
    <div className="ui-band ui-page">
      <SegmentedControl
        label="תקופה"
        showLabel={false}
        tone="band"
        value={current}
        onChange={setCurrent}
        options={[
          { value: "month", label: "חודש" },
          { value: "months3", label: "3 חודשים", short: "3 ח׳" },
          { value: "months6", label: "6 חודשים", short: "6 ח׳" },
          { value: "year", label: "שנה" },
          { value: "all", label: "הכול" },
        ]}
      />
    </div>
  );
}

export const OnBand: Story = {
  args: { label: "תקופה", value: "expenses", onChange: () => undefined, options: [] },
  render: () => <BandDemo />,
};
export const OnBandDark: Story = { ...OnBand, name: "On band, dark", globals: { theme: "dark" } };
export const OnBand320: Story = { ...OnBand, name: "On band, 320", parameters: { viewport: { defaultViewport: "flow320" } } };

const percents = [
  { value: "0.8", label: "80%", numeric: true },
  { value: "0.85", label: "85%", numeric: true },
  { value: "0.9", label: "90%", numeric: true },
  { value: "0.95", label: "95%", numeric: true },
];

/** #231 follow-up: numeric options draw in an LTR bdi, so "90%" keeps its sign on the right. */
export const Numeric: Story = {
  args: { label: "סף ביטחון", value: "0.9", onChange: () => undefined, options: percents },
};
export const Numeric320: Story = { ...Numeric, name: "Numeric, 320", parameters: { viewport: { defaultViewport: "flow320" } } };

/** #231 follow-up: a save is running. The group is aria-busy and ignores taps, and keeps focus. */
export const Busy: Story = {
  args: { label: "סף ביטחון", value: "0.9", onChange: () => undefined, options: percents, busy: true },
};
export const BusyDark: Story = { ...Busy, name: "Busy, dark", globals: { theme: "dark" } };
