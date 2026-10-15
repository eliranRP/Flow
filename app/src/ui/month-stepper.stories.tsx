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


export const Both: Story = {
  args: { earlier: "תזרים אוגוסט", later: "תזרים אוקטובר" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("button")).toHaveLength(2);
  },
};
export const BothNoPlay: Story = { args: { earlier: "תזרים אוגוסט", later: "תזרים אוקטובר" } };
/** The current month: the later chevron stays, dimmed and disabled. */
export const CurrentMonth: Story = {
  args: { earlier: "תזרים ספטמבר", later: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
  },
};
export const CurrentMonthNoPlay: Story = { args: { earlier: "תזרים ספטמבר", later: null } };
/** The books' first month: the earlier chevron is disabled. */
export const FirstMonth: Story = { args: { earlier: null, later: "תזרים אפריל" } };
