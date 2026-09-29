import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MoneyField } from "./money-field";
import { longHebrew, padded } from "./story-support";

function Demo({ label, value = "", error, disabled }: { label: string; value?: string; error?: string; disabled?: boolean }) {
  const [amount, setAmount] = useState(value);
  return <MoneyField label={label} value={amount} onValueChange={setAmount} error={error} disabled={disabled} />;
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
export const Empty: Story = { args, render: () => <Demo label="סכום לפני מע״מ" /> };
export const Disabled: Story = { args: { ...args, value: "1500" }, render: () => <Demo label="סכום לפני מע״מ" value="1500" disabled /> };
export const Error: Story = { args: { ...args, error: "סכום לא תקין" }, render: () => <Demo label="סכום לפני מע״מ" value="12" error="סכום לא תקין" /> };
export const LargeAmount: Story = { args: { ...args, value: "9999999.99" }, render: () => <Demo label="תקציב בשקלים, או ריק" value="9999999.99" /> };
export const LargeAmount320: Story = {
  args: { ...args, value: "9999999.99" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <Demo label="תקציב בשקלים, או ריק" value="9999999.99" />,
};
export const LargeAmount320Dark: Story = {
  args: { ...args, value: "9999999.99" },
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <Demo label="תקציב בשקלים, או ריק" value="9999999.99" />,
};
export const LongHebrew: Story = { args: { ...args, label: longHebrew }, render: () => <Demo label={longHebrew} value="9999999.99" /> };
