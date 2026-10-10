import type { CashMonths, ProjectDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { sampleCashMonths, sampleCashYearMonths, sampleCashYears } from "../dev/cash-sample";
import { SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME, SAMPLE_RECURRING_CHANGES } from "../forecast-sample";
import { at320, dark, exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ProjectDetailScreen } from "./flow-screens";
import { ProjectCashHistoryScreen, ProjectCashYearScreen } from "./project-cash-history";

/**
 * The project page like Home (owner, 2026-10-10): "לכל החודשים" under the earlier months opens the
 * project's history, years then months, and Home's attention rows show the project's own alerts.
 * Invented figures.
 */

const meta = {
  title: "Screens/Project cash history",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const project: NonNullable<ProjectDetail> = {
  id: "p1",
  name: "Cedar Ave 410",
  status: "active",
  state_label: "פעיל",
  budget_agorot: null,
  base_currency: "ILS",
  income_agorot: 1_500_000n,
  direct_agorot: -900_000n,
  shared_agorot: 0n,
  profit_agorot: 600_000n,
  by_currency: [{ currency: "ILS", income_minor: 1_500_000n, direct_minor: 900_000n, shared_minor: 0n, profit_minor: 600_000n }],
  categories: [],
  pending_count: 2,
  pending_agorot: 45_000n,
  transactions: [],
  loans: [],
};

const cash: NonNullable<CashMonths> = sampleCashMonths();

/** p1's alerts only: one late bill (p2's is left out), late income, and one changed charge. */
const recurring = { late: [...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME], changes: SAMPLE_RECURRING_CHANGES };

export const PageLikeHome: Story = {
  name: "Project page, alerts and לכל החודשים",
  render: () => (
    <StoryRoute entry="/projects/p1" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCash={cash} sampleRecurring={recurring} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "לכל החודשים" })).toHaveAttribute("href", "/projects/p1/cash/history");
    await expect(canvas.getByRole("link", { name: /ממתינים לאישור/ })).toHaveAttribute("href", "/review?project=p1");
    await expect(canvas.getByRole("link", { name: "חשבון אחד לא הגיע" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /חשמל עלה ב־38%/ })).toBeInTheDocument();
  },
};
export const PageLikeHomeDark: Story = { ...PageLikeHome, name: "Project page, alerts and לכל החודשים, dark", ...dark };
export const PageLikeHome320: Story = { ...PageLikeHome, name: "Project page, alerts and לכל החודשים, 320", ...at320 };

export const Years: Story = {
  name: "Project history, years",
  render: () => (
    <StoryRoute entry="/projects/p1/cash/history" tabs>
      <ProjectCashHistoryScreen sample={{ ...sampleCashYears(), project_name: "Cedar Ave 410" }} projectId="p1" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Cedar Ave 410")).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "שנים" })).toBeInTheDocument();
    const years = canvas.getAllByRole("link", { name: /^תזרים \d{4} / });
    await expect(years).toHaveLength(4);
    await expect(years[0]?.getAttribute("href")).toMatch(/^\/projects\/p1\/cash\/year\/\d{4}$/);
  },
};
export const YearsDark: Story = { ...Years, name: "Project history, years, dark", ...dark };
export const Years320: Story = { ...Years, name: "Project history, years, 320", ...at320 };

function yearSample() {
  const months = sampleCashYearMonths();
  return { months, years: { ...sampleCashYears(), project_name: "Cedar Ave 410" }, year: Number(months.months[0]?.month.slice(0, 4)) };
}

export const Year: Story = {
  name: "Project history, a past year",
  render: () => {
    const { months, years, year } = yearSample();
    return (
      <StoryRoute entry={`/projects/p1/cash/year/${String(year)}`} tabs>
        <ProjectCashYearScreen sample={{ months, years }} year={year} projectId="p1" />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "חודשים" })).toBeInTheDocument();
    const months = canvas.getAllByRole("link", { name: /^תזרים \S+ \d{4} / });
    await expect(months).toHaveLength(12);
    await expect(months[0]?.getAttribute("href")).toMatch(/^\/projects\/p1\/cash\/\d{4}-12$/);
  },
};
export const YearDark: Story = { ...Year, name: "Project history, a past year, dark", ...dark };
export const Year320: Story = { ...Year, name: "Project history, a past year, 320", ...at320 };
