import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { JUNIPER_NEXT, JUNIPER_NEXT_LOAN } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import { ProjectNextEditScreen, type ProjectNextEditSample } from "./project-next-edit-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function page(preset: Partial<ProjectNextEditSample>, add = false) {
  return (
    <StoryRoute entry={add ? "/projects/juniper-ct/profit/next/add" : "/projects/juniper-ct/profit/next/edit/avg%3Arepairs"} tabs>
      <ExampleBar />
      <ProjectNextEditScreen add={add} sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT, ...preset }} />
    </StoryRoute>
  );
}

/** FLOW-1137: while the page's reads (or the role) load, its skeleton shows, not a blank page. */
export const ProjectNextEditLoading: Story = {
  name: "Project, next month forecast, edit loading",
  render: () => (
    <StoryRoute entry="/projects/juniper-ct/profit/next/edit/avg%3Arepairs?preview=loading" tabs>
      <ExampleBar />
      <ProjectNextEditScreen />
    </StoryRoute>
  ),
  play: async () => {
    await waitFor(() => expect(document.querySelector("[aria-busy='true'] [role='status']")).not.toBeNull());
  },
};

/** ProfitNextEdit: the repairs average's edit page, typed as 1,200 (high against its usual $310). */
export const ProjectNextEdit: Story = {
  name: "Project, next month forecast, edit a row",
  render: () => page({ rowKey: "avg:repairs", draft: "1200" }),
};

/** A loan row's edit page: the loan's interest for November, from its schedule (לפי ההלוואה). */
export const ProjectNextEditLoan: Story = {
  name: "Project, next month forecast, edit a loan row",
  render: () => page({ next: JUNIPER_NEXT_LOAN, rowKey: "avg:loan-interest" }),
};

/** ProfitNextAdd: a new line of the property manager's category, at its usual $305. */
export const ProjectNextAdd: Story = {
  name: "Project, next month forecast, add a line",
  render: () => page({ categoryId: "property-mgmt", draft: "305" }, true),
};

/** ProfitNextSearch: the category sheet searching ביטוח. */
export const ProjectNextSearch: Story = {
  name: "Project, next month forecast, category search",
  render: () => page({ sheet: "category", query: "ביטוח" }, true),
};

/** ProfitNextNoMatch: no category by the name, and the create row. */
export const ProjectNextNoMatch: Story = {
  name: "Project, next month forecast, category not found",
  render: () => page({ sheet: "category", query: "שמירה" }, true),
};

/** ProfitNextPace: the כל כמה זמן sheet, every quarter chosen. */
export const ProjectNextPace: Story = {
  name: "Project, next month forecast, pace",
  render: () => page({ categoryId: "pest", draft: "65", pace: "quarter", sheet: "pace" }, true),
};

/** FLOW-1063 (decision 0259): the category sheet offers the forecast's own categories too, "כבר בצפי · $4,150" on rent. */
export const ProjectNextAddInForecast: Story = {
  name: "Project, next month forecast, category already in the forecast",
  render: () => page({ sheet: "category", query: "שכירות" }, true),
};

/** FLOW-1063: a second rent line picked, an income every month next to the tenants' rents. */
export const ProjectNextAddSecondIncome: Story = {
  name: "Project, next month forecast, a second income line",
  render: () => page({ categoryId: "rent", draft: "1000", pace: "month" }, true),
};
