import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar, type JobStep } from "./progress-bar";
import { padded } from "./story-support";

const meta = {
  title: "Components/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  decorators: [padded],
  args: { variant: "bar", value: 42, max: 100, label: "התקדמות" },
  argTypes: {
    variant: { control: "select", options: ["bar", "thin", "steps"] },
    value: { control: "number" },
    max: { control: "number" },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { variant: "bar", value: 42, label: "התקדמות" } };
export const Full: Story = { args: { variant: "bar", value: 100, label: "התקדמות" } };
// Amounts are bigints, which args cannot carry (Storybook sends args as JSON), so these render them.
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
