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
