import type { Meta, StoryObj } from "@storybook/react";
import { Button, type ButtonVariant } from "./button";
import { longHebrew, padded } from "./story-support";

const variants: ButtonVariant[] = [
  "primary",
  "secondary",
  "link",
  "danger-link",
  "pill",
  "danger",
  "danger-tint",
  "danger-outline",
  "ghost",
];

const meta = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  decorators: [padded],
  args: { children: "אישור", variant: "primary" },
  argTypes: {
    variant: { control: "select", options: variants },
    busy: { control: "boolean" },
    disabled: { control: "boolean" },
    full: { control: "boolean" },
    chevron: { control: "boolean" },
    onClick: { action: "clicked" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { children: "שינוי", variant: "secondary" } };
export const Link: Story = { args: { children: "לכל החיובים", variant: "link", chevron: true } };
/** FLOW-445: the destructive confirm's second choice, outlined, so the red stays on the one action. */
export const DangerOutline: Story = { args: { children: "מחיקת הפרויקט", variant: "danger-outline", full: true } };
export const DangerLink: Story = { args: { children: "מחיקה", variant: "danger-link" } };
export const Disabled: Story = { args: { disabled: true } };
export const Busy: Story = { args: { children: "שומר…", busy: true } };
export const LongHebrew: Story = { args: { children: longHebrew, full: true } };
export const AsRouteLink: Story = { args: { children: "הגדרות", variant: "secondary", to: "/settings" } };

/** The old variants keep their look until their screens move (R11 deletes them). */
export const Legacy: Story = {
  args: { children: "" },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="pill">פרויקט חדש</Button>
      <Button variant="danger">מחיקה</Button>
      <Button variant="danger-tint">מחיקה</Button>
      <Button variant="ghost">דלג</Button>
      <Button variant="ghost" quiet>
        ביטול
      </Button>
    </div>
  ),
};
