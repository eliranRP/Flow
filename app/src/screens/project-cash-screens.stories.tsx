import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cash, investment, project, thisMonth } from "../dev/project-cash-sample";
import { kindNextSample } from "../dev/project-kinds-next-sample";
import { devProjectsCash } from "../dev/projects-sample";
import { shiftMonthKey } from "../period";
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

/** The flip's row on the Projects list: it began three months ago, with its purchase. */
const base = devProjectsCash.projects[0];
const flipRow = base == null ? undefined : { ...base, id: project.id, first_month: `${shiftMonthKey(thisMonth, -3)}-01`, deletable: false };
const flipNext = kindNextSample("flip", project.id);

const sectionTo = (target: string) => (target === "overview" ? "/projects/p-c" : `/projects/p-c/${target}`);

export const ProjectCash: Story = {
  name: "Project, cash first",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCash={cash} sampleInvestment={investment} sampleMenuRow={flipRow} sampleNext={flipNext} sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /^רווח ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "השקעה והלוואות" })).toBeInTheDocument();
    // spec-fcwide: the flip's card (no income, grey $0) and its chart since the purchase replace "חודשים קודמים".
    await expect(canvas.getByRole("link", { name: /^צפי .*: צפוי להיכנס \$0,/ })).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: /^נכנס ויצא לפי חודש, מתחילת הפרויקט/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "רווח לפי חודש" })).toBeInTheDocument();
  },
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
