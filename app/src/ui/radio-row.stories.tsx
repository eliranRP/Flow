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
export const WithDescription: Story = {
  args: {
    label: "שווה בין כל הפרויקטים",
    description: "₪250 לכל אחד מ־4 פרויקטים",
    marker: "start",
    selected: true,
    onSelect: () => undefined,
  },
};
export const DisabledWithReason: Story = {
  args: {
    label: "לפי הכנסות",
    marker: "start",
    disabledReason: "אין הכנסות בתקופה הזו",
    selected: false,
    onSelect: () => undefined,
  },
};
export const DisabledWithReasonDark: Story = {
  args: DisabledWithReason.args,
  globals: { theme: "dark" },
};
export const Saving: Story = {
  args: {
    label: "שווה בין כל הפרויקטים",
    description: "₪250 לכל אחד מ־4 פרויקטים",
    marker: "start",
    selected: true,
    busy: true,
    onSelect: () => undefined,
  },
};
export const DisabledWithReason320: Story = {
  args: DisabledWithReason.args,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
