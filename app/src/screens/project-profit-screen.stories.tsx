import type { ProfitMonths, ProjectDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { ProjectProfitScreen, type ProjectProfitSample } from "./project-profit-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Invented project in USD with the board's figures: since March 2025, 20 months, after overhead on. */
const juniper = {
  id: "juniper-ct",
  name: "Juniper Ct",
  status: "active",
  state_label: "פעיל",
  base_currency: "USD",
  by_currency: [{ currency: "USD", income_minor: 7_605_000n, direct_minor: 5_457_000n, shared_minor: 0n, profit_minor: 2_148_000n }],
  overhead_weighted: true,
  overhead_share_minor: 304_000n,
  after_overhead: true,
  transactions: [],
} as unknown as NonNullable<ProjectDetail>;

const months: NonNullable<ProfitMonths> = {
  basis: "cash",
  from: "2025-03-01",
  to: "2026-10-16",
  project_id: "juniper-ct",
  after_overhead: true,
  base_currency: "USD",
  months: [
    { month: "2026-10", from: "2026-10-01", to: "2026-10-16", open: true, by_currency: [{ currency: "USD", income_minor: 63020000n, expense_minor: 25060000n, profit_minor: 37960000n }] },
    { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "USD", income_minor: 41500000n, expense_minor: 17400000n, profit_minor: 24100000n }] },
    { month: "2026-08", from: "2026-08-01", to: "2026-08-31", open: false, by_currency: [{ currency: "USD", income_minor: 41500000n, expense_minor: 17600000n, profit_minor: 23900000n }] },
    { month: "2026-07", from: "2026-07-01", to: "2026-07-31", open: false, by_currency: [{ currency: "USD", income_minor: 41500000n, expense_minor: 17000000n, profit_minor: 24500000n }] },
    { month: "2026-06", from: "2026-06-01", to: "2026-06-30", open: false, by_currency: [{ currency: "USD", income_minor: 41500000n, expense_minor: 18700000n, profit_minor: 22800000n }] },
    { month: "2026-05", from: "2026-05-01", to: "2026-05-31", open: false, by_currency: [{ currency: "USD", income_minor: 41500000n, expense_minor: 18000000n, profit_minor: 23500000n }] },
  ],
  by_currency: [{ currency: "USD", income_minor: 7_605_000n, expense_minor: 5_457_000n, profit_minor: 2_148_000n }],
};

const sample: ProjectProfitSample = { project: juniper, months };

function ProfitRoute({ entry }: { entry: string }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ProjectProfitScreen sample={sample} />
    </StoryRoute>
  );
}

export const ProjectProfit: Story = {
  name: "Project profit, summary and months",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit" />,
};

/** Reached from the company profit page: Back names "רווח". */
export const ProjectProfitFromCompany: Story = {
  name: "Project profit, opened from company profit",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit?from=profit" />,
};
