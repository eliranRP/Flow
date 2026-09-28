import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { PercentField } from "./money-field";
import { padded } from "./story-support";

function Demo({ label, value = "" }: { label: string; value?: string }) {
  const [share, setShare] = useState(value);
  return <PercentField label={label} value={share} onValueChange={setShare} />;
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
