import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { InstallScreen } from "./install-screen";

/** FLOW-502 follow-up: Chrome and Firefox on iPhone show their own share steps, not Safari's •••. */
const meta = {
  title: "Components/InstallScreen",
  component: InstallScreen,
  args: { mode: "iphone-other", browser: "chrome", onDismiss: () => undefined },
} satisfies Meta<typeof InstallScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IphoneChrome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("מקישים על סמל השיתוף בשורת הכתובת")).toBeInTheDocument();
    await expect(canvas.queryByText("•••")).toBeNull();
  },
};
export const IphoneChromeNoPlay: Story = {};
export const IphoneFirefox: Story = { args: { browser: "firefox" } };
export const IphoneOtherBrowser: Story = { args: { browser: "other" } };
