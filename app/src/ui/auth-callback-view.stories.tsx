import type { Meta, StoryObj } from "@storybook/react";
import { afterSignInMessage } from "../safe-return";
import { AuthCallbackView } from "./auth-callback-view";

const meta = {
  title: "Screens/AuthCallback",
  component: AuthCallbackView,
} satisfies Meta<typeof AuthCallbackView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connecting: Story = { args: { message: "מתחברים…" } };
export const ToHome: Story = { args: { message: afterSignInMessage(true, null) } };
/** The longest return line, the 320 check. */
export const ToFiledToday: Story = { args: { message: afterSignInMessage(true, "/review/filed") } };
export const ToFiledTodayDark: Story = { args: { message: afterSignInMessage(true, "/review/filed") }, globals: { theme: "dark" } };
export const ToSetup: Story = { args: { message: afterSignInMessage(false, null) } };
