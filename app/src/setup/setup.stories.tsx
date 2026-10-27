
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { StoryRoute } from "../ui/story-route";
import { PROJECT_ADD, PROJECT_NAME_EMPTY, REVIEW_APPROVE, REVIEW_BEFORE } from "./copy";
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

/** FLOW-976: הוספה is never greyed out; a tap with no name says what is missing. */
export const Step3ProjectsNoName: Story = {
  name: "Step 3 · projects, הוספה with no name",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/3">
      <StepProjects {...noop} companyId="company-story" bankConnected={false} existingNames={["Birch Lane"]} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: PROJECT_ADD }));
    // The note is there at once; the step's fade-in can still hold it at opacity 0 under load.
    await expect(canvas.getByText(PROJECT_NAME_EMPTY)).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByText(PROJECT_NAME_EMPTY)).toBeVisible());
    await expect(canvas.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    // A second tap keeps the note on screen.
    await userEvent.click(canvas.getByRole("button", { name: PROJECT_ADD }));
    await expect(canvas.getByText(PROJECT_NAME_EMPTY)).toBeVisible();
  },
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
  // FLOW-976: before the approval the bottom button is neutral, enabled, and takes focus to אישור.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const before = canvas.getByRole("button", { name: REVIEW_BEFORE });
    await expect(before).toBeEnabled();
    await userEvent.click(before);
    await expect(canvas.getByRole("button", { name: REVIEW_APPROVE })).toHaveFocus();
  },
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
