import type { Meta, StoryObj } from "@storybook/react";
import { CheckRow } from "./check-row";
import { padded } from "./story-support";

const meta = {
  title: "Components/CheckRow",
  component: CheckRow,
  decorators: [padded],
} satisfies Meta<typeof CheckRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const row = { label: "מגדל משרדים פ״ת", value: "₪250", onChange: () => undefined };

export const Unchecked: Story = { args: { ...row, checked: false } };
export const Checked: Story = { args: { ...row, checked: true } };
export const CheckedDark: Story = { args: { ...row, checked: true }, globals: { theme: "dark" } };
export const Checked320: Story = {
  args: { ...row, checked: true },
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ReadOnly: Story = { args: { label: "וילה רעננה", value: "₪250", readOnly: true } };
