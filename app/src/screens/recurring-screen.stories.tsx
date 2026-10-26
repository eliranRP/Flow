import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecurringList } from "../ui/recurring-list";
import { RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "../recurring-sample";
import { StoryRoute } from "../ui/story-route";
import { RecurringScreen, recurringView } from "./recurring-screen";

/** FLOW-447: the list on the rule-25 fixture. The viewport toolbar sets the width. */
const view = recurringView(RECURRING_FIXTURE, "2026-10-11");

const meta = {
  title: "Screens/Recurring",
  render: () => <RecurringList {...view} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** FLOW-963: offline with the rows on screen, the line under the head says which moment they are from. */
export const Offline: Story = { render: () => <RecurringList {...view} offlineSince={Date.parse("2026-10-11T06:41:00Z")} /> };

/** FLOW-963: the late bills with their question, the two equal answers under the row. */
export const LateAsk: Story = {
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/recurring">
      <RecurringScreen now={new Date("2026-10-11T12:00:00Z")} sample={RECURRING_FIXTURE} missing={RECURRING_MISSING_FIXTURE} />
    </StoryRoute>
  ),
};

/** FLOW-963: the schedule read failed: the title stays, with what happened, נסו שוב and צריך עזרה?. */
export const Failed: Story = {
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/recurring">
      <RecurringScreen now={new Date("2026-10-11T12:00:00Z")} sample={RECURRING_FIXTURE} failed />
    </StoryRoute>
  ),
};
