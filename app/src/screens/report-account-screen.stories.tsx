import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { REPORT_ACCOUNT_LOAN, REPORT_ACCOUNT_QUIET } from "../dev/report-account-sample";
import { ExampleBar } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ReportAccountScreen, type ReportAccountSample } from "./report-account-screen";

/** FLOW-165: a balance-sheet account's movements, opened from the balance sheet (board ReportAccountDrill). */
const meta = {
  title: "Screens/Reports/Account",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ENTRY = "/reports/account?kind=balance&scope=project&project=a0000000-0000-4000-8000-000000000161&account=l-loan&cur=USD";

function Account({ sample }: { sample: Omit<ReportAccountSample, "today"> }) {
  return (
    <StoryRoute entry={ENTRY} tabs>
      <ExampleBar />
      <ReportAccountScreen sample={{ today: "2026-10-31", ...sample }} />
    </StoryRoute>
  );
}

/** A loan's principal: today's balance, what was owed on 1 January, the year's payments by month, the loan page. */
export const LoanPrincipal: Story = {
  name: "Account · a loan's principal",
  render: () => <Account sample={{ page: REPORT_ACCOUNT_LOAN }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("יתרה היום")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /לדף ההלוואה/ }).getAttribute("href")).toBe("/loans/d0000000-0000-4000-8000-000000000165");
    await expect(canvas.getAllByRole("link", { name: /Example Mortgage Co · קרן/ })).toHaveLength(3);
    await expect(canvas.getByRole("button", { name: "עוד 7 תנועות" })).toBeInTheDocument();
  },
};

export const NoMovement: Story = { name: "Account · no movement this year", render: () => <Account sample={{ page: REPORT_ACCOUNT_QUIET }} /> };
export const NotFound: Story = { name: "State · account not found", render: () => <Account sample={{ page: null }} /> };
export const Loading: Story = { name: "State · loading", render: () => <Account sample={{}} /> };
export const Failed: Story = { name: "State · failed to load", render: () => <Account sample={{ failed: true }} /> };
export const Offline: Story = { name: "State · offline", render: () => <Account sample={{ page: REPORT_ACCOUNT_LOAN, offlineSince: Date.parse("2026-10-31T07:41:00Z") }} /> };
