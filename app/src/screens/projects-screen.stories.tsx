import type { ProjectCashRow, ProjectsCashMonth } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ProjectsScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, sampleDashboard } from "../ui/screen-stories-support";

/** FLOW-445: one project's row in the month's cash (the list reads projects_cash_month). Invented names only. */
function cashRow(input: { id: string; name: string; net?: number; type?: string | null; status?: "active" | "finished"; overhead?: boolean; group?: string | null; fresh?: boolean; spent?: number; budget?: number; profitAll?: number }): ProjectCashRow {
  const net = input.net ?? 0;
  return {
    id: input.id,
    name: input.name,
    type: input.type ?? null,
    status: input.status ?? "active",
    is_overhead: input.overhead ?? false,
    group_id: input.group ?? null,
    created_at: input.fresh ? "2026-10-15T08:00:00Z" : "2026-08-01T08:00:00Z",
    finished_on: input.status === "finished" ? "2026-09-30" : null,
    budget_minor: input.budget ?? null,
    spent_minor: input.spent ?? 0,
    cash: net === 0 ? [] : [{ currency: "ILS", in_minor: Math.max(net, 0), out_minor: Math.max(-net, 0), net_minor: net }],
    profit_month_minor: net,
    profit_all_minor: input.profitAll ?? net,
    first_month: input.fresh ? null : "2026-08-01",
    pending_count: 0,
    deletable: false,
  };
}

function cashMonth(projects: ProjectCashRow[], unassigned = { count: 0, net: 0 }): NonNullable<ProjectsCashMonth> {
  return {
    month: "2026-10-01",
    base_currency: "ILS",
    basis: "paid",
    projects,
    unassigned: {
      count: unassigned.count,
      cash: unassigned.net === 0 ? [] : [{ currency: "ILS", in_minor: 0, out_minor: Math.abs(unassigned.net), net_minor: unassigned.net }],
    },
  };
}

const activeMonth = cashMonth(
  [
    cashRow({ id: "lark", name: "Lark Hill", type: "flip", net: -12_000_00, spent: 9_000_00, budget: 10_000_00 }),
    cashRow({ id: "okafor", name: "Okafor", type: "לקוח", net: 45_000_00 }),
    cashRow({ id: "juniper", name: "Juniper Ct", type: "flip", net: -8_000_00, spent: 12_000_00, budget: 10_000_00 }),
    cashRow({ id: "tidewater", name: "Tidewater", type: "השכרה", net: 3_000_00 }),
    cashRow({ id: "quarry", name: "Quarry Rd", type: "השכרה", net: 0 }),
    cashRow({ id: "office", name: "משרד החברה / תקורה", overhead: true, net: -5_000_00 }),
  ],
  { count: 2, net: -1_500_00 },
);

const withFinished = cashMonth([
  ...activeMonth.projects,
  cashRow({ id: "wren", name: "Wren St", type: "flip", status: "finished", profitAll: 80_000_00 }),
  cashRow({ id: "ashby", name: "Ashby Rd", type: "השכרה", status: "finished", profitAll: -4_000_00 }),
], { count: 2, net: -1_500_00 });

/** Many projects with long names and kind words (board V3-States, long content). */
const LONG_MONTH = cashMonth([
  ...withFinished.projects,
  ...Array.from({ length: 14 }, (_, index) => cashRow({
    id: `long-${String(index)}`,
    name: `פרויקט עם שם ארוך מאוד שלא נגמר ${String(index + 1)}`,
    type: index % 3 === 0 ? "שיפוץ · לפני מכירה ועם עוד מילים" : index % 3 === 1 ? "השכרה · שני דיירים" : "לקוח · שלב 3 מתוך 8",
    net: (index % 2 === 0 ? -1 : 1) * (index + 1) * 1_234_00,
  })),
], { count: 2, net: -1_500_00 });

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

/** FLOW-1044 (board V3-Projects): the band, פעילים, the rows in groups by kind, and the lines with no project as one row at the end. */
export const ProjectsList: Story = {
  name: "Projects, active, in groups by kind",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={withFinished} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("heading", { name: "דורש טיפול" })).toBeNull();
    await expect(canvas.getByRole("link", { name: /בלי פרויקט/ })).toHaveAttribute("href", expect.stringMatching(/^\/projects\/unassigned/));
    await expect(canvas.getByRole("heading", { name: "שיפוץ" })).toBeInTheDocument();
    await expect(canvas.queryByText("Wren St")).toBeNull();
  },
};

/** הסתיימו: the finished projects, each with its final result. */
export const ProjectsFinished: Story = {
  name: "Projects, finished",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={withFinished} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getAllByRole("radiogroup", { name: "סינון פרויקטים" })[0] as HTMLElement).getByRole("radio", { name: "הסתיימו" }));
    await expect(await canvas.findByText("Wren St")).toBeInTheDocument();
    await expect(canvas.queryByText("Tidewater")).toBeNull();
  },
};

/** הכול: active and finished together, in their kinds. */
export const ProjectsAll: Story = {
  name: "Projects, all",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={withFinished} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getAllByRole("radiogroup", { name: "סינון פרויקטים" })[0] as HTMLElement).getByRole("radio", { name: "הכול" }));
    await expect(await canvas.findByText("Wren St")).toBeInTheDocument();
    await expect(canvas.getByText("Tidewater")).toBeInTheDocument();
  },
};

/** Scrolled: the band bar slides in and the filter docks into it. */
export const ProjectsDocked: Story = {
  name: "Projects, the filter docked",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={LONG_MONTH} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 700, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};

/** Long names and many rows (board V3-States, long content). */
export const ProjectsLong: Story = {
  name: "Projects, long content",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={LONG_MONTH} />
    </StoryRoute>
  ),
};

/** FLOW-1044 (board V3-NewProject): the kind comes first and the fields follow it. One story per kind. */
function newProjectStory(kind: "שיפוץ" | "השכרה" | "לקוח" | "תקורה", fields: string[]): Story {
  return {
    render: () => (
      <StoryRoute entry="/projects" tabs>
        <ExampleBar />
        <ProjectsScreen sample={sampleDashboard} cashSample={activeMonth} />
      </StoryRoute>
    ),
    play: async ({ canvasElement }) => {
      await userEvent.click(within(canvasElement).getAllByRole("button", { name: "פרויקט חדש" })[0] as HTMLElement);
      const dialog = await within(document.body).findByRole("dialog", { name: "פרויקט חדש" });
      await userEvent.click(within(dialog).getByRole("radio", { name: kind }));
      for (const field of fields) await expect(within(dialog).getByRole("textbox", { name: field })).toBeInTheDocument();
      await expect(within(dialog).getAllByRole("textbox")).toHaveLength(fields.length + 1);
      await expect(within(dialog).getByRole("button", { name: "יצירת פרויקט" })).toBeEnabled();
    },
  };
}

export const ProjectsNewRenovation: Story = { name: "Projects, new project, renovation", ...newProjectStory("שיפוץ", ["מחיר קנייה", "תקציב שיפוץ", "שווי צפוי אחרי שיפוץ"]) };
export const ProjectsNewRental: Story = { name: "Projects, new project, rental", ...newProjectStory("השכרה", ["מחיר קנייה", "שווי הנכס היום"]) };
export const ProjectsNewClient: Story = { name: "Projects, new project, client", ...newProjectStory("לקוח", ["סכום החוזה"]) };
export const ProjectsNewOverhead: Story = { name: "Projects, new project, overhead", ...newProjectStory("תקורה", []) };

/** FLOW-961: יצירת פרויקט is never disabled; with no name the tap says what to fill, under the field. */
export const ProjectsNewMissingName: Story = {
  name: "Projects, new project, the name missing",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={activeMonth} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole("button", { name: "פרויקט חדש" })[0] as HTMLElement);
    const dialog = await within(document.body).findByRole("dialog", { name: "פרויקט חדש" });
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת פרויקט" }));
    // The field says it under itself (TextField: aria-invalid and its live message line, plan §3.7).
    await expect(within(dialog).getByRole("textbox", { name: "שם הפרויקט" })).toHaveAccessibleDescription("צריך שם כדי ליצור את הפרויקט");
  },
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
