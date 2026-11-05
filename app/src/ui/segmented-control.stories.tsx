import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
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

/** FLOW-1043: the selected pill is one indicator that slides to the picked option (a jump under reduced motion). */
function Filter({ tone }: { tone: "page" | "band" }) {
  const [value, setValue] = useState("all");
  return (
    <div className={tone === "band" ? "ui-band ui-page" : undefined}>
      <SegmentedControl
        label="סינון תנועות"
        showLabel={false}
        tone={tone}
        value={value}
        onChange={setValue}
        options={[
          { value: "all", label: "הכול" },
          { value: "fixed", label: "קבועים" },
          { value: "left", label: "נותר לשלם" },
        ]}
      />
    </div>
  );
}

/** The indicator ends on the picked option, under dir=rtl. */
async function slides(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const indicator = canvasElement.querySelector<HTMLElement>(".ui-seg-ind");
  await expect(indicator).not.toBeNull();
  await expect(indicator).toHaveAttribute("aria-hidden", "true");
  const target = canvas.getByRole("radio", { name: "נותר לשלם" });
  await userEvent.click(target);
  await waitFor(async () => {
    const pill = (indicator as HTMLElement).getBoundingClientRect();
    const box = target.getBoundingClientRect();
    await expect(Math.round(pill.left)).toBe(Math.round(box.left));
    await expect(Math.round(pill.width)).toBe(Math.round(box.width));
  });
  await expect(target).toHaveAttribute("aria-checked", "true");
}

export const Slides: Story = {
  args: { label: "סינון תנועות", value: "all", onChange: () => undefined, options: [] },
  render: () => <Filter tone="page" />,
  play: async ({ canvasElement }) => {
    await slides(canvasElement);
  },
};

/** On the band: a white indicator and the selected label in the accent colour. */
export const SlidesOnBand: Story = {
  args: { label: "סינון תנועות", value: "all", onChange: () => undefined, options: [] },
  render: () => <Filter tone="band" />,
  play: async ({ canvasElement }) => {
    await slides(canvasElement);
  },
};

