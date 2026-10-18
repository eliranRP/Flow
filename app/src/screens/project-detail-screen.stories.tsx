import type { ProjectDetail as ProjectDetailData } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { ProjectDetailScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { FILLED } from "../ui/investment-card.stories-support";
import { ExampleBar, exampleOnBand, storyBody } from "../ui/screen-stories-support";
import { kindSample, type ProjectKind } from "../dev/project-kinds-sample";
import { devProjectsCash } from "../dev/projects-sample";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectDetail: Story = {
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "משפ׳ כהן · מתחילת הפרויקט",
          budget_agorot: 100_000_000n,
          income_agorot: 90_000_000n,
          direct_agorot: 72_000_000n,
          shared_agorot: 0n,
          profit_agorot: 18_000_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 30_000_000n },
            { id: "c2", name: "קבלני משנה", amount_agorot: 22_000_000n },
            { id: "c3", name: "עבודה", amount_agorot: 12_000_000n },
          ],
          pending_count: 1,
          pending_agorot: 8_000_000n,
          transactions: [
            {
              id: "t1",
              description: "חומרי בניין לדוגמה",
              doc_date: "2026-09-14",
              amount_net: -8_500_000n,
              direction: "expense",
              category: "חומרים",
            },
          ],
        }}
      />
    </StoryRoute>
  ),
};

export const ProjectDetailLoading: Story = {
  render: () => (
    <StoryRoute entry="/projects/a?preview=loading" tabs>
      <ProjectDetailScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const ProjectDetailError: Story = {
  render: () => (
    <StoryRoute entry="/projects/a?preview=error" tabs>
      <ExampleBar />
      <ProjectDetailScreen />
    </StoryRoute>
  ),
};


const periodProject: NonNullable<ProjectDetailData> = {
  id: "p-a",
  name: "וילה לדוגמה",
  status: "active",
  state_label: "פעיל",
  budget_agorot: 100_000_000n,
  income_agorot: 36_600_000n,
  direct_agorot: 26_420_000n,
  shared_agorot: 0n,
  profit_agorot: 10_180_000n,
  categories: [
    { id: "c1", name: "קבלני משנה", amount_agorot: 11_800_000n },
    { id: "c2", name: "חומרים", amount_agorot: 8_240_000n },
    { id: "c3", name: "עבודה", amount_agorot: 4_120_000n },
  ],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [
    { id: "pt1", description: "חשמלאי לדוגמה", doc_date: "2026-10-05", amount_net: -632_000n, direction: "expense", category: "עבודה" },
    { id: "pt2", description: "החזר ציוד לדוגמה", doc_date: "2026-10-02", amount_net: -150_000n, direction: "expense", category: "ציוד", kept_out: true },
    { id: "pt3", description: "חומרי בניין לדוגמה", doc_date: "2026-09-18", amount_net: -1_200_000n, direction: "expense", category: "חומרים", parts_minor: 800_000n },
    { id: "pt4", description: "תשלום לקוח לדוגמה", doc_date: "2026-08-20", amount_net: 18_600_000n, direction: "income", category: null },
  ],
};

/** FLOW-404. The השקעה card under the categories, with invented figures. */
export const ProjectInvestment: Story = {
  name: "Project with investment card",
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sampleInvestment={{ isOverhead: false, figures: FILLED, categories: [], loans: [] }}
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 40_000_000n,
          direct_agorot: 26_130_000n,
          shared_agorot: 0n,
          profit_agorot: 13_870_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 14_280_000n },
            { id: "c2", name: "קבלן משנה", amount_agorot: 11_850_000n },
          ],
          pending_count: 0,
          pending_agorot: 0n,
          transactions: [],
        }}
      />
    </StoryRoute>
  ),
};

/** FLOW-340 C. The short project page: profit on the band, then one row per section. */
const overviewProject: NonNullable<ProjectDetailData> = {
  ...periodProject,
  loans: [
    // The open balances add up to the investment card's יתרת הלוואות (FILLED, ₪800,000).
    { id: "l1", name: "הלוואת גישור לדוגמה", currency: "ILS", balance_minor: 50_000_000n, status: "open" },
    { id: "l2", name: "משכנתא לדוגמה", currency: "ILS", balance_minor: 30_000_000n, status: "open" },
  ],
};
const sectionTo = (target: string) => (target === "overview" ? "/projects/p-a" : `/projects/p-a/${target}`);
const filledInvestment = { isOverhead: false, figures: FILLED, categories: [], loans: [] };

export const ProjectOverview: Story = {
  name: "Project, short page (FLOW-340 C)",
  render: () => (
    <StoryRoute entry="/projects/p-a" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={overviewProject} sampleInvestment={filledInvestment} sectionTo={sectionTo} />
    </StoryRoute>
  ),
};

/** FLOW-334: the ⋯ menu, the overhead switch then "סיום הפרויקט" as a row. */
export const ProjectMenu: Story = {
  name: "Project, ⋯ menu",
  render: ProjectOverview.render,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "וילה לדוגמה" });
  },
};

/** FLOW-360 A: the edit sheet's קבוצה row (opened from the ⋯ menu), then its picker and the new group sheet. */
const sampleGroups = {
  groups: [{ id: "g1", name: "בניין לדוגמה" }, { id: "g2", name: "מתחם לדוגמה" }],
  currentId: null,
};
const groupedRender = (currentId: string | null) => () => (
  <StoryRoute entry="/projects/p-a" tabs>
    <ProjectDetailScreen
      example={exampleOnBand}
      sample={overviewProject}
      sampleInvestment={filledInvestment}
      sectionTo={sectionTo}
      sampleGroups={{ ...sampleGroups, currentId }}
    />
  </StoryRoute>
);
const openEditSheet: NonNullable<Story["play"]> = async (context) => {
  await ProjectMenu.play?.(context);
  await userEvent.click(await storyBody(context.canvasElement).findByRole("button", { name: /^עריכת פרטים/ }));
  await storyBody(context.canvasElement).findByRole("dialog", { name: "עריכת פרויקט" });
};

export const ProjectMenuGroup: Story = {
  name: "Project, edit sheet with קבוצה",
  render: groupedRender(null),
  play: openEditSheet,
};

export const ProjectGroupPicker: Story = {
  name: "Project, group picker",
  render: groupedRender("g1"),
  play: async (context) => {
    await openEditSheet(context);
    await userEvent.click(await storyBody(context.canvasElement).findByRole("button", { name: /קבוצה/ }));
    await storyBody(context.canvasElement).findByRole("radiogroup", { name: "קבוצה" });
  },
};

/** A finished project offers "החזרה לפעיל" in the same place. */
export const ProjectMenuFinished: Story = {
  name: "Project, ⋯ menu, finished",
  render: () => (
    <StoryRoute entry="/projects/p-a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{ ...overviewProject, status: "finished", state_label: "הסתיים" }}
        sampleInvestment={filledInvestment}
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
  play: ProjectMenu.play,
};

/** The neutral confirm: the button repeats the action, with no red and no bin. */
export const ProjectFinishConfirm: Story = {
  name: "Project, finish confirm",
  render: ProjectOverview.render,
  play: async (context) => {
    await ProjectMenu.play?.(context);
    const body = storyBody(context.canvasElement);
    // FLOW-445: the row carries its hint, and the confirm names the project.
    await userEvent.click(await body.findByRole("button", { name: /^סיום הפרויקט/ }));
    await body.findByRole("dialog", { name: /^לסיים את/ });
  },
};

/** The board's three other kinds of project page: a rental, a client job, and a project with nothing filed yet. */
function kindStory(kind: Exclude<ProjectKind, "flip">): Story {
  const data = kindSample(kind, devProjectsCash.projects[0]);
  return {
    render: () => (
      <StoryRoute entry={`/projects/${data.project.id}`} tabs>
        <ProjectDetailScreen
          example={exampleOnBand}
          sample={data.project}
          sampleCash={data.cash}
          sampleInvestment={data.investment}
          sampleMenuRow={data.row}
          sectionTo={(target) => (target === "overview" ? `/projects/${data.project.id}` : `/projects/${data.project.id}/${target}`)}
        />
      </StoryRoute>
    ),
  };
}

export const ProjectRentalPage: Story = { name: "Project, rental", ...kindStory("rental") };
