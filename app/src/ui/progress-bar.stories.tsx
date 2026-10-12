import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./progress-bar";
import { largeAgorot, longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  decorators: [padded],
  args: { variant: "bar", value: 42, max: 100, label: "התקדמות" },
  argTypes: {
    variant: { control: "select", options: ["bar", "thin", "split"] },
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
  render: () => <ProgressBar variant="split" label="טק-ליין" spentAgorot={4_000_000n} budgetAgorot={10_000_000n} />,
};
export const SplitOver: StoryObj<SplitArgs> = {
  args: { variant: "split", label: longHebrew },
  render: () => (
    <ProgressBar variant="split" label={longHebrew} spentAgorot={largeAgorot} budgetAgorot={largeAgorot - 1_000_000n} />
  ),
};
