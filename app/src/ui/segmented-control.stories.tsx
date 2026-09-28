import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SegmentedControl } from "./segmented-control";
import { longHebrew, padded } from "./story-support";

function Demo({ value, long = false }: { value: "cash" | "invoiced"; long?: boolean }) {
  const [current, setCurrent] = useState(value);
  return (
    <SegmentedControl
      label="בסיס"
      value={current}
      onChange={setCurrent}
      options={
        long
          ? [
              { value: "cash", label: longHebrew },
              { value: "invoiced", label: "חשבוניות" },
            ]
          : [
              { value: "cash", label: "מזומן" },
              { value: "invoiced", label: "חשבוניות" },
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

export const Cash: Story = {
  args: {
    label: "בסיס",
    value: "cash",
    onChange: () => undefined,
    options: [
      { value: "cash", label: "מזומן" },
      { value: "invoiced", label: "חשבוניות" },
    ],
  },
  render: () => <Demo value="cash" />,
};
export const Invoiced: Story = {
  args: {
    label: "בסיס",
    value: "invoiced",
    onChange: () => undefined,
    options: [
      { value: "cash", label: "מזומן" },
      { value: "invoiced", label: "חשבוניות" },
    ],
  },
  render: () => <Demo value="invoiced" />,
};
export const LongHebrew: Story = {
  args: {
    label: longHebrew,
    value: "cash",
    onChange: () => undefined,
    options: [
      { value: "cash", label: longHebrew },
      { value: "invoiced", label: "חשבוניות" },
    ],
  },
  render: () => <Demo value="cash" long />,
};
