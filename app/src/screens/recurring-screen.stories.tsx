import type { Meta, StoryObj } from "@storybook/react";
import { RecurringList } from "../ui/recurring-list";
import { RECURRING_FIXTURE } from "../recurring-sample";
import { recurringView } from "./recurring-screen";

/** FLOW-447: the list on the rule-25 fixture. The viewport toolbar sets the width. */
const view = recurringView(RECURRING_FIXTURE, "2026-10-11");

const meta = {
  title: "Screens/Recurring",
  render: () => <RecurringList {...view} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
