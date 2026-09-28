import type { Meta, StoryObj } from "@storybook/react";
import { ErrorState } from "./error-state";

const meta = {
  title: "Components/ErrorState",
  component: ErrorState,
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offline: Story = { args: { offline: true, onRetry: () => undefined } };
export const Server: Story = { args: { offline: false, onRetry: () => undefined } };
