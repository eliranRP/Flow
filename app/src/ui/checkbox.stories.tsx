import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "./checkbox";
import { padded } from "./story-support";

function Demo({ checked, disabled = false }: { checked: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(checked);
  return <Checkbox label="הצגת פרויקטים שהסתיימו" checked={on} disabled={disabled} onChange={setOn} />;
}

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  decorators: [padded],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

const base = { label: "הצגת פרויקטים שהסתיימו", checked: false, onChange: () => undefined };

export const Off: Story = { args: base, render: () => <Demo checked={false} /> };
export const On: Story = { args: { ...base, checked: true }, render: () => <Demo checked /> };
export const Disabled: Story = { args: { ...base, disabled: true }, render: () => <Demo checked={false} disabled /> };
