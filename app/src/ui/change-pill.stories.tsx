import type { Meta, StoryObj } from "@storybook/react";
import { ChangePill } from "./change-pill";
import { padded } from "./story-support";

const meta = {
  title: "Components/ChangePill",
  component: ChangePill,
  decorators: [padded],
} satisfies Meta<typeof ChangePill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Down: Story = { args: { percent: -10, comparison: "מחודש שעבר" } };
export const Up: Story = { args: { percent: 12, comparison: "מחודש שעבר" } };
export const OnBand: Story = {
  args: { percent: -10, comparison: "מחודש שעבר", onBand: true },
  render: (args) => (
    <div className="ui-band">
      <ChangePill {...args} />
    </div>
  ),
};
export const Flat: Story = { args: { percent: 0, comparison: "מחודש שעבר" } };
export const Tiny: Story = { args: { percent: 0.2, comparison: "מחודש שעבר" } };
