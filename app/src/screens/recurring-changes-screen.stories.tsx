import type { Meta, StoryObj } from "@storybook/react-vite";
import { SAMPLE_RECURRING_THIS_MONTH } from "../forecast-sample";
import { expect, userEvent, within } from "storybook/test";
import { StoryRoute } from "../ui/story-route";
import { longHebrew } from "../ui/story-support";
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

/** Long names, and more changes than fit (V3-States). */
export const LongContent: Story = {
  render: () => (
    <StoryRoute entry="/recurring/changes">
      <RecurringChangesScreen sample={[...two, ...two].map((row, index) => ({ ...row, transaction_id: `${row.transaction_id}-${String(index)}`, category_name: index % 2 === 0 ? `${row.category_name ?? "חשמל"} ${longHebrew}` : row.category_name }))} />
    </StoryRoute>
  ),
};

/** The X marks a change as seen: the row leaves, and the toast offers ביטול. */
export const MarkedSeen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first] = canvas.getAllByRole("button", { name: /^סקרתי: / });
    await userEvent.click(first as HTMLElement);
    await expect(await within(canvasElement.ownerDocument.body).findByRole("button", { name: "ביטול" })).toBeInTheDocument();
  },
};

/** The read failed: the title stays, with what happened and נסו שוב (V3-States). */
export const Failed: Story = {
  render: () => (
    <StoryRoute entry="/recurring/changes?preview=error">
      <RecurringChangesScreen />
    </StoryRoute>
  ),
};
