import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { cash, investment, project, thisMonth } from "../dev/project-cash-sample";
import { kindNextSample } from "../dev/project-kinds-next-sample";
import { devProjectsCash } from "../dev/projects-sample";
import { shiftMonthKey } from "../period";
import { exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { restoreAll } from "../ui/attention-dismiss";
import { projectLinesSample, projectScheduleSample } from "./project-lines-sample";
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
const flipRow = base == null ? undefined : { ...base, id: project.id, type: "flip · בשיפוץ", first_month: `${shiftMonthKey(thisMonth, -3)}-01`, deletable: false };
const flipNext = kindNextSample("flip", project.id);

const schedule = projectScheduleSample(project.id);
const lines = projectLinesSample();

const sectionTo = (target: string) => (target === "overview" ? "/projects/p-c" : `/projects/p-c/${target}`);

/** FLOW-1044 (board V3-Project): a renovation. The band as today, then the budget, the links and the month's lines in groups. */
export const ProjectCash: Story = {
  name: "Project, renovation",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCash={cash} sampleInvestment={investment} sampleMenuRow={flipRow} sampleNext={flipNext} sampleSchedule={schedule} sampleLines={lines} sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /^השקעה והלוואות/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /^רווח מתחילת הפרויקט/ })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "נותר לשלם" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "קבועים ששולמו" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חד-פעמי" })).toBeInTheDocument();
  },
};

/** נותר לשלם: only what is still to come this month. */
export const ProjectCashLeft: Story = {
  name: "Project, renovation, נותר לשלם",
  render: ProjectCash.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "סינון תנועות החודש" })).getByRole("radio", { name: "נותר לשלם" }));
    await expect(canvas.queryByRole("heading", { name: "קבועים ששולמו" })).toBeNull();
    await expect(canvas.queryByRole("heading", { name: "חד-פעמי" })).toBeNull();
  },
};

/** Scrolled: the detail bar slides in and the segment docks into it. */
export const ProjectCashDocked: Story = {
  name: "Project, the segment docked",
  render: ProjectCash.render,
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 900, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};

/** FLOW-1044: the ⋯ sheet asks before a finish, inside the sheet. */
export const ProjectCashFinishConfirm: Story = {
  name: "Project, finish confirm in the ⋯ sheet",
  render: ProjectCash.render,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole("button", { name: "עוד" })[0] as HTMLElement);
    const menu = await within(document.body).findByRole("dialog", { name: project.name });
    await userEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    await expect(await within(document.body).findByRole("dialog", { name: `לסיים את ${project.name}?` })).toBeInTheDocument();
  },
};

/** The attention cards on the page, one hidden and then all hidden. */
export const ProjectCashAttentionHidden: Story = {
  name: "Project, attention cards, hidden",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={{ ...project, pending_count: 0, budget_agorot: 7_500_000n, direct_agorot: -6_200_000n }} sampleCash={cash} sampleInvestment={investment} sampleMenuRow={flipRow} sampleSchedule={schedule} sampleLines={lines} sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    restoreAll(`project:${project.id}`);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole("button", { name: /^הסתרה: / })[0] as HTMLElement);
    await expect(await canvas.findByText(/אין מה לטפל/u)).toBeInTheDocument();
    restoreAll(`project:${project.id}`);
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
