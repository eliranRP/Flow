import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  REPORTS_BALANCE,
  REPORTS_BALANCE_SUSPENSE,
  REPORTS_BY_PROJECT,
  REPORTS_EMPTY,
  REPORTS_PROJECT_IDS,
  REPORTS_STATEMENT,
  REPORTS_TODAY,
} from "../dev/reports-sample";
import { ExampleBar } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { HomeReportsCard } from "./home-reports-card";
import { ReportLinesScreen } from "./report-lines-screen";
import { ReportsScreen, type ReportsSample } from "./reports-screen";

/** FLOW-161: the reports screen, the category drill-down and the Home card (board row "דוחות"). */
const meta = {
  title: "Screens/Reports",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Reports({ entry = "/reports", sample = {} }: { entry?: string; sample?: Partial<ReportsSample> }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT, ...sample }} />
    </StoryRoute>
  );
}

/** The P&L of every project this year: the net first, then income, expenses and the bottom line. */
export const ProfitAndLoss: Story = {
  name: "P&L · all projects",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("30% מההכנסות · 01/01/2026–31/10/2026")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /ריבית משכנתא/ })).toBeInTheDocument();
  },
};

/** כיווץ הכל: every section shut, each total still on its header. */
export const Collapsed: Story = {
  name: "P&L · collapsed",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "כיווץ הכל" }));
    await expect(canvas.getByRole("button", { name: "פתיחת הכל" })).toBeInTheDocument();
  },
};

export const ByProject: Story = {
  name: "P&L · by project",
  render: () => <Reports entry="/reports?scope=by_project" sample={{ statement: REPORTS_BY_PROJECT }} />,
};

export const OneProject: Story = {
  name: "P&L · one project",
  render: () => <Reports entry={`/reports?scope=project&project=${REPORTS_PROJECT_IDS.cedar}`} sample={{ statement: { ...REPORTS_STATEMENT, project_id: REPORTS_PROJECT_IDS.cedar, project_name: "Cedar St" } }} />,
};

export const BalanceSheet: Story = {
  name: "Balance sheet · today",
  render: () => <Reports entry="/reports?kind=balance" />,
};

export const BalanceSuspense: Story = {
  name: "Balance sheet · Suspense",
  render: () => <Reports entry="/reports?kind=balance" sample={{ balance: REPORTS_BALANCE_SUSPENSE }} />,
};

export const PeriodSheet: Story = {
  name: "Sheet · period",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "השנה · 2026" }));
  },
};

export const CustomDates: Story = {
  name: "Sheet · custom dates",
  render: () => <Reports entry="/reports?period=custom&from=2026-10-05&to=2026-10-20" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "05/10/2026–20/10/2026" }));
  },
};

export const ProjectsSheet: Story = {
  name: "Sheet · projects",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "כל הפרויקטים" }));
  },
};

export const Empty: Story = { name: "State · empty period", render: () => <Reports entry="/reports?period=last_month" sample={{ statement: REPORTS_EMPTY }} /> };
export const Loading: Story = { name: "State · loading", render: () => <Reports sample={{ phase: { kind: "loading" } }} /> };
export const Failed: Story = { name: "State · failed to load", render: () => <Reports sample={{ phase: { kind: "error", offline: false } }} /> };
export const Offline: Story = { name: "State · offline", render: () => <Reports sample={{ offlineSince: Date.parse("2026-10-31T07:41:00Z") }} /> };

function line(id: string, date: string, dollars: number, project: string, supplier: string) {
  return {
    transaction_id: `b0000000-0000-4000-8000-00000000${id}`,
    part: null,
    description: supplier,
    supplier_name: supplier,
    project_name: project,
    category_name: "תיקונים ותחזוקה",
    doc_date: date,
    currency: "USD",
    amount_minor: BigInt(dollars * 100),
    shared: false,
  };
}

export const CategoryLines: Story = {
  name: "Drill-down · a category",
  render: () => (
    <StoryRoute entry="/reports/lines?side=expense&category=c-repairs&name=%D7%AA%D7%99%D7%A7%D7%95%D7%A0%D7%99%D7%9D%20%D7%95%D7%AA%D7%97%D7%96%D7%95%D7%A7%D7%94&from=2026-01-01&to=2026-10-31&cur=USD" tabs>
      <ExampleBar />
      <ReportLinesScreen
        sample={{
          rows: [
            line("0001", "2026-10-18", 1_250, "Cedar St", "Quick Fix Plumbing"),
            line("0002", "2026-10-09", 400, "Maple Ave", "Northside Hardware"),
            line("0003", "2026-09-22", 980, "Oak Ridge", "Bright Electric"),
            line("0004", "2026-09-11", 200, "Riverside Commons Phase Two Townhomes", "Northside Hardware"),
          ],
          hasMore: true,
        }}
      />
    </StoryRoute>
  ),
};

export const HomeCard: Story = {
  name: "Home · דוחות card",
  render: () => (
    <StoryRoute entry="/">
      <HomeReportsCard today={REPORTS_TODAY} search="" enabled={false} sample={{ statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE }} />
    </StoryRoute>
  ),
};
