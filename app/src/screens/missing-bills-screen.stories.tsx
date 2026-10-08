import type { Meta, StoryObj } from "@storybook/react";
import { MissingBillsScreen } from "./missing-bills-screen";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD } from "../forecast-sample";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// FLOW-403, plan option A2: "לא הגיעו", opened from Home's pending card.
export const MissingBills: Story = {
  name: "Missing bills",
  render: () => (
    <StoryRoute entry="/missing-bills" tabs>
      <ExampleBar />
      <MissingBillsScreen sample={[...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_USD]} />
    </StoryRoute>
  ),
};
export const MissingBillsDark: Story = { ...MissingBills, name: "Missing bills, dark", ...dark };
export const MissingBills320: Story = { ...MissingBills, name: "Missing bills, 320", ...at320 };
export const MissingBillsEmpty: Story = {
  name: "Missing bills, empty",
  render: () => (
    <StoryRoute entry="/missing-bills" tabs>
      <ExampleBar />
      <MissingBillsScreen sample={[]} />
    </StoryRoute>
  ),
};
