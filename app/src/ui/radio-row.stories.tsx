import type { Meta, StoryObj } from "@storybook/react";
import { RadioRow } from "./radio-row";
import { padded } from "./story-support";

const meta = {
  title: "Components/RadioRow",
  component: RadioRow,
  decorators: [padded],
} satisfies Meta<typeof RadioRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {
  args: { label: "החודש", hint: "ספטמבר 2026", selected: true, onSelect: () => undefined },
};
export const Idle: Story = {
  args: { label: "חודש קודם", hint: "אוגוסט 2026", selected: false, onSelect: () => undefined },
};
