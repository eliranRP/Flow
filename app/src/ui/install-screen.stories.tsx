import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { InstallScreen } from "./install-screen";
import { at320, dark } from "./screen-stories-support";

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
export const IphoneChrome320: Story = { ...at320 };
export const IphoneChromeDark320: Story = { ...at320, ...dark };
export const IphoneFirefox: Story = { args: { browser: "firefox" } };
export const IphoneFirefox320: Story = { args: { browser: "firefox" }, ...at320 };
export const IphoneFirefoxDark320: Story = { args: { browser: "firefox" }, ...at320, ...dark };
export const IphoneOtherBrowser320: Story = { args: { browser: "other" }, ...at320 };
