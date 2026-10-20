import type { ProjectCashRow, ProjectsCashMonth } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
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
  name: "Projects, the list with cash per project",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={activeMonth} />
    </StoryRoute>
  ),
};

/** FLOW-445: the finished projects stay closed until הצג opens them. */
export const ProjectsFinished: Story = {
  name: "Projects, finished shown",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={withFinished} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /הסתיימו/u }));
    await expect(await canvas.findByText("Wren St")).toBeInTheDocument();
  },
};

/** FLOW-445: the new-project sheet; its save stays disabled until a name is typed. */
export const ProjectsNewSheet: Story = {
  name: "Projects, new project sheet",
  render: () => (
    <StoryRoute entry="/projects" tabs>
      <ExampleBar />
      <ProjectsScreen sample={sampleDashboard} cashSample={activeMonth} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "+ פרויקט חדש" }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(within(dialog).getByRole("button", { name: "יצירת פרויקט" })).toBeDisabled();
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
