import type { Meta, StoryObj } from "@storybook/react";
import { RecurringList } from "../ui/recurring-list";
import { RECURRING_FIXTURE } from "../recurring-sample";
import { recurringView } from "./recurring-screen";

/** FLOW-447: the list on the rule-25 fixture, at the two phone widths the board uses. */
const view = recurringView(RECURRING_FIXTURE, "2026-10-11");

const meta = {
  title: "Screens/Recurring",
  render: () => <RecurringList {...view} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Phone320: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <RecurringList {...view} />
    </div>
  ),
};

export const Phone393: Story = {
  render: () => (
    <div style={{ width: 393 }}>
      <RecurringList {...view} />
    </div>
  ),
};
