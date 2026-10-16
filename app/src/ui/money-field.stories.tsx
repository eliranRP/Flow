import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
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

/** FLOW-310: the prefix keeps the same gap to the digits however many commas and dots they hold. */
function Separators() {
  return (
    <div className="flex flex-col gap-4">
      <Demo label="סכום" value="5" />
      <Demo label="סכום" value="1500" />
      <Demo label="סכום" value="1234567.89" />
      <Demo label="סכום בדולרים" value="1234567.89" prefix="$" />
    </div>
  );
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
export const PrefixGap: Story = { args, render: () => <Separators /> };
export const LongHebrew: Story = { args: { ...args, label: longHebrew }, render: () => <Demo label={longHebrew} value="9999999.99" /> };
/** A percent share: the % sits in the padding, on the same box as an amount (FLOW-363 (4)). */
export const Percent: Story = { args: { ...args, value: "33.3" }, render: () => <PercentDemo label="אחוז" value="33.3" /> };
export const PercentError: Story = { args: { ...args, value: "120", error: "עד 100%" }, render: () => <PercentDemo label="אחוז" value="120" error="עד 100%" /> };
export const PercentDisabled: Story = { args: { ...args, value: "25", disabled: true }, render: () => <PercentDemo label="אחוז" value="25" disabled /> };
/** FLOW-325: a row's message outside the field describes it (aria-describedby). */
export const DescribedByRowMessage: Story = {
  args: { ...args, value: "2000", describedBy: "money-row-message" },
  render: () => (
    <div>
      <MoneyField label="סכום, ביטוח" value="2000" onValueChange={() => undefined} describedBy="money-row-message" />
      <p id="money-row-message" className="t-hint">החלקים עוברים את השורה ב־₪560. הקטינו חלק.</p>
    </div>
  ),
};
