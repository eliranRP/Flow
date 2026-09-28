import type { Meta, StoryObj } from "@storybook/react";
import { MoneyField } from "./money-field";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/MoneyField",
  component: MoneyField,
  decorators: [padded],
} satisfies Meta<typeof MoneyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: "סכום לפני מע״מ", defaultValue: "1500" } };
export const Empty: Story = { args: { label: "סכום לפני מע״מ", placeholder: "0" } };
export const Disabled: Story = { args: { label: "סכום לפני מע״מ", defaultValue: "1500", disabled: true } };
export const Error: Story = { args: { label: "סכום לפני מע״מ", defaultValue: "abc", error: "סכום לא תקין" } };
export const LargeAmount: Story = { args: { label: "סכום לפני מע״מ", defaultValue: "123456789" } };
export const LongHebrew: Story = { args: { label: longHebrew, defaultValue: "123456789" } };
