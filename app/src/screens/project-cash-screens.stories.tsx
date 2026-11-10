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
import { ProjectCashOverview } from "./project-cash-screens";

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
    // FLOW-1113: each payment of the month once; the paid charges are listed under קבועים only.
    await expect(canvas.getByRole("heading", { name: "תנועות החודש" })).toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "קבועים ששולמו" })).toBeNull();
    // FLOW-1156: a recurring charge's payment says so in words, not by its mark alone.
    await expect(canvas.getByText("10/11 · קבוע · ריבית")).toBeInTheDocument();
    await expect(canvas.getByText("09/11 · חומרים")).toBeInTheDocument();
  },
};

/** FLOW-1156: the month's payments in two currencies: the head counts them and names no one net. */
export const ProjectCashMixedCurrencies: Story = {
  name: "Project, the month's payments in two currencies",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCash={cash} sampleInvestment={investment} sampleMenuRow={flipRow} sampleNext={flipNext} sampleSchedule={schedule} sampleLines={[...lines, ...projectLinesSample("ILS").slice(1, 2).map((line) => ({ ...line, transaction_id: "t-mat-ils" }))]} sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const head = within(canvasElement).getByRole("heading", { name: "תנועות החודש" }).closest(".ui-month");
    if (!(head instanceof HTMLElement)) throw new Error("no month payments");
    const summary = head.querySelector(".ui-group-summary")?.textContent ?? "";
    await expect(summary).toBe("4 · מטבעות שונים");
  },
};

/** קבועים: the charges, those still to come and those paid; not the month's payments. */
export const ProjectCashFixed: Story = {
  name: "Project, renovation, קבועים",
  render: ProjectCash.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("radiogroup", { name: "סינון תנועות החודש" })).getByRole("radio", { name: "קבועים" }));
    await expect(canvas.getByRole("heading", { name: "קבועים ששולמו" })).toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "תנועות החודש" })).toBeNull();
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
    await expect(canvas.queryByRole("heading", { name: "תנועות החודש" })).toBeNull();
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

/** FLOW-1138: the links whose figures are still out: a bar holds each figure's place. */
const loadingLinks = [
  { id: "since", title: "רווח מתחילת הפרויקט", hint: "כל התקופה עד היום", loading: true, href: "/projects/p-c/profit" },
  { id: "next", title: "צפוי לחודש הבא", hint: "תזרים צפוי, לפי החודשים הקודמים", loading: true, href: "/projects/p-c/profit/next" },
];

/** FLOW-1138: the band's figure, the links' figures and the month's lines in their skeletons, never "none yet". */
async function expectLinesSkeleton(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("טוען…")).toBeInTheDocument();
  await expect(canvasElement.querySelectorAll(".ui-project-lines .ui-skel-group")).toHaveLength(2);
  await expect(canvas.queryByText("אין עדיין תנועות החודש.")).toBeNull();
  await expect(canvasElement.querySelector(".ui-skel-row")).toBeNull();
}

/** FLOW-1138: the project is in, its cash, the charges and the month's lines are not yet. */
export const ProjectCashLoading: Story = {
  name: "Project, the cash and lines loading",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectCashOverview project={project} data={null} search="" stateLine={null} menu={null} links={loadingLinks} schedule={null} lines={null} now={new Date()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expectLinesSkeleton(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^רווח מתחילת הפרויקט/ })).toBeInTheDocument();
    await expect(canvas.queryByText("מחשבים…")).toBeNull();
  },
};

/** FLOW-1138: the cash is in, the month's lines are still out. */
export const ProjectCashLinesLoading: Story = {
  name: "Project, the month's lines loading",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectCashOverview project={project} data={cash} search="" stateLine={null} menu={null} links={loadingLinks} schedule={schedule} lines={null} now={new Date()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => { await expectLinesSkeleton(canvasElement); },
};
