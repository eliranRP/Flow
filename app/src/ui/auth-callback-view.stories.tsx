import type { Meta, StoryObj } from "@storybook/react-vite";
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
