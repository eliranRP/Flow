import type { Dashboard } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { ProjectsScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, sampleDashboard } from "../ui/screen-stories-support";
import { projectsGroupDone, projectsGrouped } from "./project-groups-sample";

function listedProject(id: string, name: string, status: "active" | "finished" = "active"): Dashboard["projects"][number] {
  return {
    id,
    name,
    status,
    income_agorot: 10_000_000n,
    direct_agorot: 8_000_000n,
    shared_agorot: 0n,
    profit_before_shared_agorot: 2_000_000n,
    profit_agorot: 2_000_000n,
    by_currency: [],
  };
}

const projectsList: Dashboard = {
  ...sampleDashboard,
  projects: [
    listedProject("a", "בניין מגורים חולון"),
    listedProject("b", "וילה רעננה"),
    listedProject("c", "מגדל משרדים פ״ת"),
    ...Array.from({ length: 14 }, (_, index) => listedProject(`p${String(index)}`, `פרויקט ${String(index + 4)}`)),
    ...Array.from({ length: 21 }, (_, index) => listedProject(`f${String(index)}`, `הסתיים ${String(index + 1)}`, "finished")),
  ],
};

/** FLOW-410: more active projects than one screen, and a finished one that shares a name with an active one. */
const projectsSearch: Dashboard = {
  ...sampleDashboard,
  projects: [
    ...["בית ארז", "בית אלון", "בית ברוש", "בית דקל", "בית הדס", "בית ורד", "בית תמר", "בית חצב", "בית כלנית"].map((name, index) => listedProject(`s${String(index)}`, name)),
    listedProject("sf1", "מחסן תמר", "finished"),
    listedProject("sf2", "חנות רימון", "finished"),
  ],
};

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectsEmpty: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=empty" tabs>
      <ExampleBar />
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ProjectsList: Story = {
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsList} />
    </StoryRoute>
  ),
};

/** FLOW-410: a query searches every project; the finished match reads הסתיים. */
export const ProjectsSearch: Story = {
  name: "Projects, search finds a finished project",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsSearch} initialQuery="תמר" />
    </StoryRoute>
  ),
};
export const ProjectsSearchDark: Story = { ...ProjectsSearch, name: "Projects, search finds a finished project, dark", globals: { theme: "dark" } };
export const ProjectsSearch320: Story = {
  ...ProjectsSearch,
  name: "Projects, search finds a finished project, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectsSearchDark320: Story = {
  ...ProjectsSearch,
  name: "Projects, search finds a finished project, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

/** FLOW-410: with no query every active project shows, past the first six. */
/** FLOW-342 (A): a name that is no project offers the transaction search, one row. */
export const ProjectsMiss: Story = {
  name: "Projects, no project matches",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsSearch} initialQuery="חשמל" />
    </StoryRoute>
  ),
};
export const ProjectsMissDark: Story = { ...ProjectsMiss, name: "Projects, no project matches, dark", globals: { theme: "dark" } };
export const ProjectsMiss320: Story = {
  ...ProjectsMiss,
  name: "Projects, no project matches, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectsMissDark320: Story = {
  ...ProjectsMiss,
  name: "Projects, no project matches, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

export const ProjectsManyActive: Story = {
  name: "Projects, every active project",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsSearch} />
    </StoryRoute>
  ),
};
export const ProjectsManyActiveDark: Story = { ...ProjectsManyActive, name: "Projects, every active project, dark", globals: { theme: "dark" } };
export const ProjectsManyActive320: Story = {
  ...ProjectsManyActive,
  name: "Projects, every active project, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectsManyActiveDark320: Story = {
  ...ProjectsManyActive,
  name: "Projects, every active project, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

export const ProjectsLoading: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=loading" tabs>
      <ExampleBar />
      <ProjectsScreen />
    </StoryRoute>
  ),
};

export const ProjectsError: Story = {
  render: () => (
    <StoryRoute entry="/projects?preview=error" tabs>
      <ExampleBar />
      <ProjectsScreen />
    </StoryRoute>
  ),
};

/** FLOW-406 (proj-b): a group is one row with its project count and summed profit; it opens the group. */
export const ProjectsGrouped: Story = {
  name: "Projects, grouped",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsGrouped} />
    </StoryRoute>
  ),
};
export const ProjectsGroupedDark: Story = { ...ProjectsGrouped, name: "Projects, grouped, dark", globals: { theme: "dark" } };
export const ProjectsGrouped320: Story = {
  ...ProjectsGrouped,
  name: "Projects, grouped, 320",
  parameters: { viewport: { defaultViewport: "flow320" } },
};
export const ProjectsGroupedDark320: Story = {
  ...ProjectsGrouped,
  name: "Projects, grouped, dark, 320",
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

/** A query finds a project inside a group, and the group by its own name. */
export const ProjectsGroupedSearch: Story = {
  name: "Projects, grouped, search",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsGrouped} initialQuery="דירה 2" />
    </StoryRoute>
  ),
};

/** A group whose projects have all finished folds under עוד N שהסתיימו, and comes back when opened. */
export const ProjectsGroupDone: Story = {
  name: "Projects, a finished group folds",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={projectsGroupDone} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("מרכז מסחרי לדוגמה")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /עוד 3 שהסתיימו/ }));
    await expect(canvas.getByText("מרכז מסחרי לדוגמה")).toBeInTheDocument();
  },
};
