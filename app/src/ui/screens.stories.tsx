import type { Meta, StoryObj } from "@storybook/react";
import { HelpScreen } from "../screens/HelpScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { ProjectsScreen, ReviewScreen } from "../screens/flow-screens";
import { SignInScreen } from "../screens/SignInScreen";
import { StoryRoute } from "./story-route";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeEmpty: Story = {
  render: () => (
    <StoryRoute entry="/?preview=empty">
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeLoading: Story = {
  render: () => (
    <StoryRoute entry="/?preview=loading">
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeOffline: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error">
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeServerError: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error-server">
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeBooks: Story = {
  render: () => (
    <StoryRoute entry="/?preview=demo">
      <HomeScreen />
    </StoryRoute>
  ),
};

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

export const Projects: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=demo">
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ProjectsEmpty: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=empty">
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const Review: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=demo">
      <ReviewScreen />
    </StoryRoute>
  ),
};

export const ReviewEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=empty">
      <ReviewScreen />
    </StoryRoute>
  ),
};
