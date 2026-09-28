import type { Meta, StoryObj } from "@storybook/react";
import { longHebrew, padded } from "./story-support";
import { TextField } from "./text-field";

const meta = {
  title: "Components/TextField",
  component: TextField,
  decorators: [padded],
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: "שם הפרויקט", defaultValue: "טק-ליין" } };
export const Empty: Story = { args: { label: "שם הפרויקט", placeholder: "למשל שיפוץ דירה" } };
export const Disabled: Story = { args: { label: "שם הפרויקט", defaultValue: "טק-ליין", disabled: true } };
export const Error: Story = { args: { label: "שם הפרויקט", defaultValue: "", error: "חסר שם" } };
export const LongHebrew: Story = { args: { label: longHebrew, defaultValue: longHebrew } };
