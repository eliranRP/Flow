import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoneyField, PercentField } from "./money-field";
import { longHebrew, padded } from "./story-support";

function Demo({ label, value = "", error, disabled, prefix }: { label: string; value?: string; error?: string; disabled?: boolean; prefix?: string }) {
  const [amount, setAmount] = useState(value);
  return <MoneyField label={label} value={amount} onValueChange={setAmount} error={error} disabled={disabled} prefix={prefix} />;
}

function PercentDemo({ label, value = "", error, disabled = false }: { label: string; value?: string; error?: string; disabled?: boolean }) {
  const [share, setShare] = useState(value);
  return <PercentField label={label} value={share} onValueChange={setShare} error={error} disabled={disabled} />;
}

const meta = {
  title: "Components/MoneyField",
  component: MoneyField,
  decorators: [padded],
} satisfies Meta<typeof MoneyField>;

export default meta;
type Story = StoryObj<typeof meta>;

const args = { label: "סכום לפני מע״מ", value: "", onValueChange: () => undefined };

export const Default: Story = { args: { ...args, value: "1500" }, render: () => <Demo label="סכום לפני מע״מ" value="1500" /> };
export const Disabled: Story = { args: { ...args, value: "1500" }, render: () => <Demo label="סכום לפני מע״מ" value="1500" disabled /> };
export const Error: Story = { args: { ...args, error: "סכום לא תקין" }, render: () => <Demo label="סכום לפני מע״מ" value="12" error="סכום לא תקין" /> };
export const LargeAmount: Story = { args: { ...args, value: "9999999.99" }, render: () => <Demo label="תקציב בשקלים, או ריק" value="9999999.99" /> };
export const LongHebrew: Story = { args: { ...args, label: longHebrew }, render: () => <Demo label={longHebrew} value="9999999.99" /> };
/** A percent share: the % sits in the padding, on the same box as an amount (FLOW-363 (4)). */
export const Percent: Story = { args: { ...args, value: "33.3" }, render: () => <PercentDemo label="אחוז" value="33.3" /> };
