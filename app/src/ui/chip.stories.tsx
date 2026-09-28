import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Chip, StatusPill } from "./chip";
import { longHebrew, padded, Stack } from "./story-support";

function Choice() {
  const [pressed, setPressed] = useState(false);
  return (
    <Chip
      kind="choice"
      pressed={pressed}
      onClick={() => {
        setPressed((current) => !current);
      }}
    >
      חומרים
    </Chip>
  );
}

const meta = {
  title: "Components/Chip",
  component: Chip,
  decorators: [padded],
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Suggested: Story = { args: { kind: "suggested", children: "חומרים" } };
export const ChoiceOff: Story = { args: { kind: "choice", children: "עבודה" }, render: () => <Choice /> };
export const Selected: Story = { args: { kind: "selected", pressed: true, children: "נבחר" } };
export const Disabled: Story = { args: { kind: "disabled", children: "לא זמין" } };
export const Status: Story = { args: { children: "שולם" }, render: () => <StatusPill>שולם</StatusPill> };
export const LongHebrew: Story = { args: { kind: "choice", children: longHebrew } };
export const All: Story = {
  args: { children: "חומרים" },
  render: () => (
    <Stack>
      <Chip kind="suggested">הצעה</Chip>
      <Chip kind="choice">בחירה</Chip>
      <Chip kind="selected" pressed>נבחר</Chip>
      <Chip kind="disabled">כבוי</Chip>
      <StatusPill>מאושר</StatusPill>
    </Stack>
  ),
};
