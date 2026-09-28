import type { Meta, StoryObj } from "@storybook/react";
import { Toast } from "./toast";
import { padded } from "./story-support";

const meta = {
  title: "Components/Toast",
  component: Toast,
  decorators: [padded],
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Undo: Story = { args: { children: "הפריט אושר", action: "ביטול", onAction: () => undefined } };
export const ErrorRetry: Story = { args: { children: "לא נשמר", action: "שוב", onAction: () => undefined, tone: "bad" } };
