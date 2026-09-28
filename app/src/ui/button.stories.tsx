import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/Button",
  component: Button,
  decorators: [padded],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "שמירה", variant: "primary" } };
export const Secondary: Story = { args: { children: "שינוי", variant: "secondary" } };
export const Pill: Story = { args: { children: "פרויקט חדש", variant: "pill" } };
export const Danger: Story = { args: { children: "מחיקה", variant: "danger" } };
export const DangerTint: Story = { args: { children: "מחיקה", variant: "danger-tint" } };
export const Ghost: Story = { args: { children: "דלג", variant: "ghost" } };
export const Quiet: Story = { args: { children: "ביטול", variant: "ghost", quiet: true } };
export const Disabled: Story = { args: { children: "שמירה", disabled: true } };
export const Loading: Story = { args: { children: "שומר…", busy: true } };
export const LongHebrew: Story = { args: { children: longHebrew, full: true } };
export const Link: Story = { args: { children: "חיבור SUMIT", variant: "secondary", to: "/settings" } };
