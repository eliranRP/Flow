import type { ProjectDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { ProjectDetailScreen } from "./project-detail-screen";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_EMPTY } from "../forecast-sample";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, exampleOnBand } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const project: NonNullable<ProjectDetail> = {
  id: "p1",
  name: "הדקל 12",
  status: "active",
  state_label: null,
  budget_agorot: null,
  income_agorot: 9_600_000n,
  direct_agorot: 6_441_000n,
  shared_agorot: 0n,
  profit_agorot: 3_159_000n,
  categories: [
    { id: "c1", name: "שיפוץ", amount_agorot: 4_820_000n },
    { id: "c2", name: "חשמל", amount_agorot: 370_000n },
  ],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
};

// FLOW-403, plan option A3: the "צפוי" section under the categories.
export const ProjectExpected: Story = {
  name: "Project, expected months",
  render: () => (
    <StoryRoute entry="/projects/p1" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleExpected={SAMPLE_EXPECTED} />
    </StoryRoute>
  ),
};
export const ProjectExpectedDark: Story = { ...ProjectExpected, name: "Project, expected months, dark", ...dark };
export const ProjectExpected320: Story = { ...ProjectExpected, name: "Project, expected months, 320", ...at320 };
export const ProjectExpectedNone: Story = {
  name: "Project, no expected months yet",
  render: () => (
    <StoryRoute entry="/projects/p1" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleExpected={SAMPLE_EXPECTED_EMPTY} />
    </StoryRoute>
  ),
};
