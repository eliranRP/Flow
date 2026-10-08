import type { Meta, StoryObj } from "@storybook/react";
import { OnboardingScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Onboarding: Story = {
  render: () => (
    <StoryRoute entry="/onboarding">
      <ExampleBar />
      <OnboardingScreen />
    </StoryRoute>
  ),
};

/** FLOW-606: a pasted tab is refused on the field, as create_company refuses it. */
const OnboardingNameErrorRoute = () => (
  <StoryRoute entry="/onboarding">
    <ExampleBar />
    <OnboardingScreen initialName={"סטודיו אלפא\tלעיצוב"} />
  </StoryRoute>
);

export const OnboardingNameError: Story = { name: "Onboarding, name error", render: OnboardingNameErrorRoute };
export const OnboardingNameErrorDark: Story = {
  name: "Onboarding, name error, dark",
  render: OnboardingNameErrorRoute,
  globals: { theme: "dark" },
};
export const OnboardingNameError320: Story = {
  name: "Onboarding, name error, 320",
  render: OnboardingNameErrorRoute,
  parameters: { viewport: { defaultViewport: "flow320" } },
};
