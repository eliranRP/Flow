import type { Meta, StoryObj } from "@storybook/react-vite";
import { HelpScreen } from "../screens/HelpScreen";
import { LegalScreen } from "../screens/LegalScreen";
import { AddForm } from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import { InstallScreen } from "./install-screen";
import { StoryRoute } from "./story-route";
import { ExampleBar, exampleLabel, OfflineStory } from "./screen-stories-support";

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

/** FLOW-976: offline, sign-in says so before the tap. */
export const SignInOffline: Story = {
  name: "Sign in, offline",
  render: () => (
    <OfflineStory>
      <StoryRoute entry="/sign-in">
        <SignInScreen />
      </StoryRoute>
    </OfflineStory>
  ),
};

export const Help: Story = {
  render: () => (
    <StoryRoute entry="/help">
      <HelpScreen />
    </StoryRoute>
  ),
};

/** FLOW-979 (decision 0225): the live legal pages in the reading style; the lawyer's draft is never shown. */
export const Terms: Story = {
  render: () => (
    <StoryRoute entry="/terms">
      <LegalScreen kind="terms" />
    </StoryRoute>
  ),
};

export const Privacy: Story = {
  render: () => (
    <StoryRoute entry="/privacy">
      <LegalScreen kind="privacy" />
    </StoryRoute>
  ),
};

export const AddSheet: Story = {
  render: () => (
    <StoryRoute entry="/add">
      <ExampleBar />
      <AddForm />
    </StoryRoute>
  ),
  globals: {
    viewport: {
      value: "flow390-short",
      isRotated: false
    }
  },
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

