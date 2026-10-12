import type { Meta, StoryObj } from "@storybook/react";
import { StatusDot } from "./status-dot";
import { padded } from "./story-support";

const meta = {
  title: "Components/StatusDot",
  component: StatusDot,
  tags: ["autodocs"],
  decorators: [padded],
  args: { tone: "neutral", dot: false, children: "בהמתנה" },
  argTypes: {
    tone: { control: "select", options: ["neutral", "accent", "signal"] },
    dot: { control: "boolean" },
  },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Accent: Story = { args: { tone: "accent", children: "חודש פתוח" } };
export const Signal: Story = { args: { tone: "signal", children: "מעל התקציב" } };
export const Dot: Story = { args: { dot: true, tone: "signal" } };
export const WithIcon: Story = { args: { children: "שולם", icon: <span aria-hidden="true">✓</span> } };
