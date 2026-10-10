import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { MonthStepper } from "./month-stepper";
import { padded } from "./story-support";

/** FLOW-362 (C15-6): a month page's earlier and later chevrons. Invented month names. */
const meta = {
  title: "Components/Month stepper",
  component: MonthStepper,
  decorators: [padded],
  args: { onStep: () => undefined },
} satisfies Meta<typeof MonthStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark390 = { globals: { theme: "dark" } };

export const Both: Story = {
  args: { earlier: "תזרים אוגוסט", later: "תזרים אוקטובר" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("button")).toHaveLength(2);
  },
};
export const BothDark: Story = { args: { earlier: "תזרים אוגוסט", later: "תזרים אוקטובר" }, ...dark390 };
/** The current month: no later chevron, and the earlier one keeps its place. */
export const CurrentMonth: Story = { args: { earlier: "תזרים ספטמבר", later: null } };
/** The books' first month: no earlier chevron. */
export const FirstMonth: Story = { args: { earlier: null, later: "תזרים אפריל" } };
