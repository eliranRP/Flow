import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cash, cashRow, investment, months, project } from "../dev/project-cash-sample";
import { exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ProjectDetailScreen } from "./flow-screens";

/** FLOW-419 (owner's option A "Like Home"): a project opens on its cash. Invented figures. */

const meta = {
  title: "Screens/Project cash",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const sectionTo = (target: string) => (target === "overview" ? "/projects/p-c" : `/projects/p-c/${target}`);

export const ProjectCash: Story = {
  name: "Project, cash first",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCash={cash} sampleInvestment={investment} sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /^רווח ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "השקעה והלוואות" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
  },
};

export const ProjectCashLoss: Story = {
  name: "Project, cash first, more out than in this month",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={project}
        sampleCash={months([[cashRow(0n, 2_066_316n, -60_000n)], [cashRow(310_000n, 75_000n, 128_000n)]])}
        sampleInvestment={investment}
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
};

/** No investment data and no loan: the row hides, and the ⋯ menu keeps the way in. */
export const ProjectCashNoInvestment: Story = {
  name: "Project, cash first, no investment or loan",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={{ ...project, loans: [] }} sampleCash={cash} sectionTo={sectionTo} />
    </StoryRoute>
  ),
};

export const ProjectCashTwoCurrencies: Story = {
  name: "Project, cash first, two currencies",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={project}
        sampleCash={months([
          [cashRow(310_000n, 75_000n, 128_000n), cashRow(1_200_000n, 450_000n, 750_000n, "ILS")],
          [cashRow(310_000n, 500_000n, 95_000n)],
        ])}
        sampleInvestment={investment}
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
};
