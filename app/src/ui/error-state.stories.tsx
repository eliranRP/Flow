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

/** FLOW-334: the retry is the tint action every empty state uses (DESIGN-RULES §2.8), in both modes and at 320. */
export const ServerDark: Story = { args: Server.args, globals: { theme: "dark" } };
export const Server320: Story = { args: Server.args, parameters: { viewport: { defaultViewport: "flow320" } } };
export const OfflineDark320: Story = { args: Offline.args, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };
