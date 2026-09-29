import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { PercentField } from "./money-field";
import { padded } from "./story-support";

function Demo({
  label,
  value = "",
  error,
  disabled = false,
}: {
  label: string;
  value?: string;
  error?: string;
  disabled?: boolean;
}) {
  const [share, setShare] = useState(value);
  return <PercentField label={label} value={share} onValueChange={setShare} error={error} disabled={disabled} />;
}

const meta = {
  title: "Components/PercentField",
  component: PercentField,
  decorators: [padded],
} satisfies Meta<typeof PercentField>;

export default meta;
type Story = StoryObj<typeof meta>;

const args = { label: "אחוז", value: "", onValueChange: () => undefined };

export const Default: Story = { args: { ...args, value: "40" }, render: () => <Demo label="אחוז" value="40" /> };
export const Empty: Story = { args, render: () => <Demo label="אחוז" /> };
export const Zero: Story = { args: { ...args, value: "0" }, render: () => <Demo label="אחוז" value="0" /> };
export const OneDecimal: Story = { args: { ...args, value: "33.3" }, render: () => <Demo label="אחוז" value="33.3" /> };
export const Full: Story = { args: { ...args, value: "100" }, render: () => <Demo label="אחוז" value="100" /> };
export const FullDark: Story = { args: { ...args, value: "100" }, globals: { theme: "dark" }, render: () => <Demo label="אחוז" value="100" /> };
export const Full320: Story = {
  args: { ...args, value: "100" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <Demo label="אחוז" value="100" />,
};
export const Error: Story = { args: { ...args, value: "120", error: "עד 100%" }, render: () => <Demo label="אחוז" value="120" error="עד 100%" /> };
export const Disabled: Story = { args: { ...args, value: "25", disabled: true }, render: () => <Demo label="אחוז" value="25" disabled /> };
