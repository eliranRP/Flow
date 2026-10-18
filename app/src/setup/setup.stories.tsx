
import type { Meta, StoryObj } from "@storybook/react";
import { StoryRoute } from "../ui/story-route";
import { SetupDone } from "./done";
import { SkipSheet } from "./skip-sheet";
import { StepBusiness, StepConnect, StepInstall, StepJev, StepProjects, StepReview, type StepProps } from "./steps";

/** Invented names only (Birch Lane, Northline Supply, Lantern Home Loans). Never a board sample. */
const noop: StepProps = {
  onDone: () => undefined,
  onStamp: () => undefined,
  onSkipStep: () => undefined,
  onSkipAll: () => undefined,
  onBack: () => undefined,
};

const meta = {
  title: "Screens/Onboarding",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Step1Business: Story = {
  name: "Step 1 · business",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/1">
      <StepBusiness {...noop} companyId={null} initial={null} />
    </StoryRoute>
  ),
};

export const Step2Connect: Story = {
  name: "Step 2 · connect",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/2">
      <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
    </StoryRoute>
  ),
};

export const Step3Projects: Story = {
  name: "Step 3 · projects",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/3">
      <StepProjects {...noop} companyId="company-story" bankConnected={false} existingNames={["Birch Lane"]} />
    </StoryRoute>
  ),
};

export const Step5Jev: Story = {
  name: "Step 5 · smart tagging",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/5">
      <StepJev {...noop} />
    </StoryRoute>
  ),
};

export const Step6Review: Story = {
  name: "Step 6 · first approval",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/6">
      <StepReview {...noop} approved={false} />
    </StoryRoute>
  ),
};

export const Step7Install: Story = {
  name: "Step 7 · Home screen",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/7">
      <StepInstall {...noop} initialMode="iphone" />
    </StoryRoute>
  ),
};

export const Done: Story = {
  name: "Done",
  render: () => (
    <SetupDone
      rows={[
        { label: "העסק", value: "Birch Lane Realty", done: true, delay: 0 },
        { label: "חיבור בנק", value: "לא עכשיו", done: false, delay: 1 },
      ]}
      onHome={() => undefined}
    />
  ),
};

export const SkipSheetOpen: Story = {
  name: "Skip sheet",
  render: () => (
    <SkipSheet open onOpenChange={() => undefined} onConfirm={() => undefined} />
  ),
};
