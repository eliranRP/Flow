import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { longHebrew, padded } from "./story-support";
import { Toggle } from "./toggle";

function Demo({ checked, disabled = false, label, hint }: { checked: boolean; disabled?: boolean; label: string; hint?: string }) {
  const [on, setOn] = useState(checked);
  return <Toggle label={label} hint={hint} checked={on} disabled={disabled} onChange={setOn} />;
}

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  decorators: [padded],
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

const base = { label: "רווח אחרי חלק בכלליות", checked: false, onChange: () => undefined };

export const Off: Story = {
  args: base,
  render: () => <Demo checked={false} label="רווח אחרי חלק בכלליות" hint="כבוי · מציג רווח לפני כלליות" />,
};
export const On: Story = {
  args: { ...base, checked: true },
  render: () => <Demo checked label="אחרי חלק בכלליות" hint="דלוק · מציג רווח אחרי חלק בכלליות" />,
};
export const Disabled: Story = {
  args: { ...base, disabled: true },
  render: () => <Demo checked={false} disabled label="רווח אחרי חלק בכלליות" hint="כבוי · מציג רווח לפני כלליות" />,
};
export const LongHebrew: Story = { args: { ...base, label: longHebrew }, render: () => <Demo checked label={longHebrew} hint={longHebrew} /> };
