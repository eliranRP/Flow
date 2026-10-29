import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  REPORT_ACCOUNT_EQUITY,
  REPORT_ACCOUNT_EQUITY_2025,
  REPORT_ACCOUNT_EQUITY_ALL,
  REPORT_ACCOUNT_LOAN,
  REPORT_ACCOUNT_QUIET,
} from "../dev/report-account-sample";
import { ExampleBar } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ReportAccountScreen, type ReportAccountSample } from "./report-account-screen";

/** FLOW-165: a balance-sheet account's movements, opened from the balance sheet (board ReportAccountDrill). FLOW-171: the period choice. */
const meta = {
  title: "Screens/Reports/Account",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ENTRY = "/reports/account?kind=balance&scope=project&project=a0000000-0000-4000-8000-000000000161&account=l-loan&cur=USD";

const EQUITY_ENTRY = "/reports/account?kind=balance&account=q-partner&cur=USD";

function Account({ sample, entry = ENTRY }: { sample: Omit<ReportAccountSample, "today">; entry?: string }) {
  return (
    <StoryRoute entry={entry} tabs>
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
    await expect(canvas.getAllByRole("link", { name: /Example Mortgage Co/ })).toHaveLength(3);
    await expect(canvas.getByRole("button", { name: "עוד 7 תנועות" })).toBeInTheDocument();
  },
};

export const NoMovement: Story = { name: "Account · no movement this year", render: () => <Account sample={{ page: REPORT_ACCOUNT_QUIET }} /> };
export const NotFound: Story = { name: "State · account not found", render: () => <Account sample={{ page: null }} /> };
export const Loading: Story = { name: "State · loading", render: () => <Account sample={{}} /> };
export const Failed: Story = { name: "State · failed to load", render: () => <Account sample={{ failed: true }} /> };
export const Offline: Story = { name: "State · offline", render: () => <Account sample={{ page: REPORT_ACCOUNT_LOAN, offlineSince: Date.parse("2026-10-31T07:41:00Z") }} /> };

/** FLOW-171: nothing on the page is wider than the screen, and the title's lines stay inside it. */
async function fitsTheScreen(canvasElement: HTMLElement, width: number) {
  const root = canvasElement.ownerDocument.documentElement;
  await expect(root.clientWidth).toBeLessThanOrEqual(width);
  await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  const title = canvasElement.querySelector(".ui-page-stacked .ui-focus-title");
  await expect(title).not.toBeNull();
  const box = title?.getBoundingClientRect();
  await expect(box != null && box.left >= 0 && box.right <= root.clientWidth).toBe(true);
  await expect(title instanceof HTMLElement && title.scrollWidth <= title.clientWidth).toBe(true);
  // The whole name shows: no line is clamped away.
  await expect(title instanceof HTMLElement && title.scrollHeight <= title.clientHeight + 1).toBe(true);
}

/** This year: an equity account with a long Latin name; the period choice reads "השנה". */
export const EquityThisYear: Story = {
  name: "Account · this year (a long Latin name)",
  globals: { viewport: { value: "flow393", isRotated: false } },
  render: () => <Account entry={EQUITY_ENTRY} sample={{ page: REPORT_ACCOUNT_EQUITY }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "השנה" }).getAttribute("aria-checked")).toBe("true");
    await expect(canvas.getByText(/יתרה ב־.*1\/1\/2026/)).toBeInTheDocument();
    await expect(canvas.getByText("שינוי השנה")).toBeInTheDocument();
    await fitsTheScreen(canvasElement, 393);
  },
};

/** From the start: no opening row, the change since the start, and the movements under a heading per year. */
export const EquityFromStart: Story = {
  name: "Account · from the start (years)",
  globals: { viewport: { value: "flow393", isRotated: false } },
  render: () => <Account entry={`${EQUITY_ENTRY}&span=all`} sample={{ page: REPORT_ACCOUNT_EQUITY_ALL }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "מההתחלה" }).getAttribute("aria-checked")).toBe("true");
    await expect(canvas.queryByText(/יתרה ב־/)).toBeNull();
    await expect(canvas.getByText("שינוי מההתחלה")).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "2026" })).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "2025" })).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "דצמבר 2025" })).toBeInTheDocument();
    await fitsTheScreen(canvasElement, 393);
  },
};

/** The balance sheet dated in 2025: that year's opening and movements; the choice names the year. */
export const EquityLastYear: Story = {
  name: "Account · an earlier year (2025)",
  render: () => <Account entry={`${EQUITY_ENTRY}&asof=custom&date=2025-12-31`} sample={{ page: REPORT_ACCOUNT_EQUITY_2025 }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "שנת 2025" }).getAttribute("aria-checked")).toBe("true");
    await expect(canvas.getByText("שינוי ב־2025")).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "פברואר 2025" })).toBeInTheDocument();
  },
};

/** FLOW-171: at 320 the long Latin title breaks after its slash and stays inside the screen (dark). */
export const LongTitle320: Story = {
  name: "Account · a long Latin name at 320",
  globals: { viewport: { value: "flow320", isRotated: false }, theme: "dark" },
  render: () => <Account entry={`${EQUITY_ENTRY}&span=all`} sample={{ page: REPORT_ACCOUNT_EQUITY_ALL }} />,
  play: async ({ canvasElement }) => {
    await fitsTheScreen(canvasElement, 320);
    // The break opportunity sits after the slash, so the name never breaks inside a word.
    await expect(canvasElement.querySelector(".ui-page-stacked .ui-focus-title wbr")).not.toBeNull();
  },
};
