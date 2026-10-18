import type { Meta, StoryObj } from "@storybook/react";
import { HelpScreen } from "../screens/HelpScreen";
import { AddForm } from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import { InstallScreen } from "./install-screen";
import { StoryRoute } from "./story-route";
import { ExampleBar, exampleLabel } from "./screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  render: () => (
    <StoryRoute entry="/sign-in">
      <SignInScreen />
    </StoryRoute>
  ),
};

export const SignInFailed: Story = {
  render: () => (
    <StoryRoute entry="/sign-in?error=server_error">
      <SignInScreen />
    </StoryRoute>
  ),
};

export const Help: Story = {
  render: () => (
    <StoryRoute entry="/help">
      <HelpScreen />
    </StoryRoute>
  ),
};

export const AddSheet: Story = {
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => (
    <StoryRoute entry="/add">
      <ExampleBar />
      <AddForm />
    </StoryRoute>
  ),
};

export const InstallAndroid: Story = {
  name: "Android (prompt)",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="android-prompt" example={<span className="t-caption t-muted">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallAndroidSteps: Story = {
  name: "Android (no prompt)",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="android-steps" example={<span className="t-caption t-muted">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIphone: Story = {
  name: "iPhone Safari",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="iphone" example={<span className="t-caption t-muted">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIphoneOther: Story = {
  name: "iPhone other browser",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="iphone-other" browser="other" example={<span className="t-caption t-muted">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

export const InstallIpad: Story = {
  name: "iPad",
  render: () => (
    <StoryRoute entry="/">
      <InstallScreen mode="ipad" example={<span className="t-caption t-muted">{exampleLabel}</span>} onDismiss={() => undefined} />
    </StoryRoute>
  ),
};

