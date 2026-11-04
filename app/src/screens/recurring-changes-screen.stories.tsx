import type { Meta, StoryObj } from "@storybook/react-vite";
import { SAMPLE_RECURRING_THIS_MONTH } from "../forecast-sample";
import { StoryRoute } from "../ui/story-route";
import { RecurringChangesScreen } from "./recurring-changes-screen";

/** FLOW-1021: the power bill up 38% and the arnona bill down 30%, each with its usual amount. */
const [power, arnona] = SAMPLE_RECURRING_THIS_MONTH;
const two = power != null && arnona != null ? [power, { ...arnona, change_percent: -30, amount_minor: -91_000n }] : [];

const meta = {
  title: "Screens/Recurring changes",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/recurring/changes">
      <RecurringChangesScreen sample={two} />
    </StoryRoute>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** FLOW-1030: while the read is on its way, the screen's own title and Back over two skeleton rows. */
export const Loading: Story = {
  render: () => (
    <StoryRoute entry="/recurring/changes?preview=loading">
      <RecurringChangesScreen />
    </StoryRoute>
  ),
};

/** FLOW-1030: opened from a project page, Back names the project and goes back to it. */
export const FromProject: Story = {
  render: () => (
    <StoryRoute entry="/recurring/changes?project=p2">
      <RecurringChangesScreen sample={two} />
    </StoryRoute>
  ),
};

/** A change hidden since the row was drawn: nothing left to show. */
export const Empty: Story = {
  render: () => (
    <StoryRoute entry="/recurring/changes">
      <RecurringChangesScreen sample={[]} />
    </StoryRoute>
  ),
};
