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

/** The period bar's presets on the violet band (decision 0140). Under 360px 3 and 6 months shorten. */
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
