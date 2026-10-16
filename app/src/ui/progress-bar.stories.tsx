import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar, type JobStep } from "./progress-bar";
import { largeAgorot, longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  decorators: [padded],
  args: { variant: "bar", value: 42, max: 100, label: "התקדמות" },
  argTypes: {
    // split needs bigint amounts, which a control cannot set, so its stories render them.
    variant: { control: "select", options: ["bar", "thin"] },
    value: { control: "number", if: { arg: "variant", neq: "split" } },
    max: { control: "number", if: { arg: "variant", neq: "split" } },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { variant: "bar", value: 42, label: "התקדמות" } };
export const Full: Story = { args: { variant: "bar", value: 100, label: "התקדמות" } };
export const Thin: Story = {
  args: { variant: "thin", value: 1, max: 7, label: "התקדמות התור", caption: "1 מתוך 7" },
};
// Amounts are bigints, which args cannot carry (Storybook sends args as JSON), so these render them.
type SplitArgs = { variant: "split"; label: string };
export const Split: StoryObj<SplitArgs> = {
  args: { variant: "split", label: "טק-ליין" },
  render: (args) => <ProgressBar {...args} spentAgorot={4_000_000n} budgetAgorot={10_000_000n} />,
};
export const SplitOver: StoryObj<SplitArgs> = {
  args: { variant: "split", label: longHebrew },
  render: (args) => <ProgressBar {...args} spentAgorot={largeAgorot} budgetAgorot={largeAgorot - 1_000_000n} />,
};
/** FLOW-371: a long known job, with its count, its steps and the way to leave. Invented data. */
type JobArgs = { variant: "job"; label: string };
const steps: JobStep[] = [
  { label: "משיכת תנועות", state: "done" },
  { label: "התאמה לפרויקטים", state: "doing" },
  { label: "בדיקת כפילויות", state: "todo" },
];
export const Job: StoryObj<JobArgs> = {
  args: { variant: "job", label: "התקדמות הסנכרון הראשון" },
  render: (args) => (
    <ProgressBar
      {...args}
      value={120}
      max={340}
      count="120 מתוך כ־340 תנועות"
      steps={steps}
      onLeave={() => undefined}
    />
  ),
};
