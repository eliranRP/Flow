import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";
import {
  AndroidInstallDemo,
  FirstApprovalDemo,
  IosInstallDemo,
  JevSwitchDemo,
  ProjectsDemo,
  SumitConnectDemo,
} from "./setup-demos";
import { forceReducedMotion } from "./reduced-motion";

const meta = {
  title: "Components/SetupDemos",
  component: SumitConnectDemo,
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "heading-order", enabled: false },
          { id: "page-has-heading-one", enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof SumitConnectDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

async function playToReplay({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByRole("button", { name: "שוב" })).toBeVisible(), { timeout: 7000 });
  await expect(canvasElement.querySelector(".ui-demo")).toHaveAttribute("data-demo-state", "settled");
}

export const Sumit: Story = { decorators: [forceReducedMotion] };

export const SumitPlaying: Story = { play: playToReplay };

export const Jev: Story = {
  decorators: [forceReducedMotion],
  render: () => <JevSwitchDemo />,
};

export const JevPlaying: Story = {
  render: () => <JevSwitchDemo />,
  play: playToReplay,
};

export const Projects: Story = {
  decorators: [forceReducedMotion],
  render: () => <ProjectsDemo />,
};

export const ProjectsPlaying: Story = {
  render: () => <ProjectsDemo />,
  play: playToReplay,
};

export const Approval: Story = {
  decorators: [forceReducedMotion],
  render: () => <FirstApprovalDemo />,
};

export const ApprovalPlaying: Story = {
  render: () => <FirstApprovalDemo />,
  play: playToReplay,
};

export const IosInstall: Story = {
  decorators: [forceReducedMotion],
  render: () => <IosInstallDemo />,
};

export const IosInstallPlaying: Story = {
  render: () => <IosInstallDemo />,
  play: playToReplay,
};

export const AndroidInstall: Story = {
  decorators: [forceReducedMotion],
  render: () => <AndroidInstallDemo />,
};

export const AndroidInstallPlaying: Story = {
  render: () => <AndroidInstallDemo />,
  play: playToReplay,
};
