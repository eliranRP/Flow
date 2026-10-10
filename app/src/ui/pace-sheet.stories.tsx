import type { Meta, StoryObj } from "@storybook/react";
import { PaceSheet } from "./pace-sheet";
import { padded } from "./story-support";

/** FLOW-415 step D: "כל כמה זמן" for a recurring charge. */
const meta = {
  title: "Components/PaceSheet",
  component: PaceSheet,
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
} satisfies Meta<typeof PaceSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Monthly: Story = {
  args: { open: true, onOpenChange: () => undefined, value: "month", saving: null, onPick: () => undefined },
};
export const Quarterly: Story = { args: { ...Monthly.args, value: "quarter" } };
/** The tapped row spins; the others wait until the save settles. */
export const Saving: Story = { args: { ...Monthly.args, saving: "2months" } };
export const MonthlyDark: Story = { args: Monthly.args, globals: { theme: "dark" } };
export const Monthly320: Story = { args: Monthly.args, parameters: { viewport: { defaultViewport: "flow320" } } };
