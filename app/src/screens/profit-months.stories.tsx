import type { ProfitMonths } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { ProfitMonthsScreen } from "./profit-months";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, ExampleBar, periodMonths } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function MonthsRoute({ data }: { data: NonNullable<ProfitMonths> }) {
  return (
    <StoryRoute entry="/projects/p-a/months?period=months6&at=2026-10" tabs>
      <ExampleBar />
      <ProfitMonthsScreen sample={{ projectName: "וילה לדוגמה", data }} />
    </StoryRoute>
  );
}

export const ProfitByMonth: Story = { name: "Project by month", render: () => <MonthsRoute data={periodMonths} /> };
export const ProfitByMonthDark: Story = { ...ProfitByMonth, name: "Project by month, dark", ...dark };
export const ProfitByMonth320: Story = { ...ProfitByMonth, name: "Project by month, 320", ...at320 };
export const ProfitByMonthDark320: Story = { ...ProfitByMonth, name: "Project by month, dark, 320", ...dark, ...at320 };
/** Overhead on: a month with project income shows its share; one without says לפני הוצאות כלליות. */
export const ProfitByMonthOverhead: Story = {
  name: "Project by month, after overhead, two currencies",
  render: () => (
    <MonthsRoute
      data={{
        ...periodMonths,
        after_overhead: true,
        months: periodMonths.months.slice(1, 4).map((month) => ({
          ...month,
          overhead_weighted: month.month === "2026-08",
          overhead_share_agorot: month.month === "2026-08" ? 1_200_000n : null,
          by_currency: month.month === "2026-08"
            ? [...month.by_currency, { currency: "USD", income_minor: 0n, expense_minor: 45_000n, profit_minor: -45_000n }]
            : [...month.by_currency, { currency: "USD", income_minor: 0n, expense_minor: 0n, profit_minor: 0n }],
        })),
      }}
    />
  ),
};
export const ProfitByMonth320Overhead: Story = { ...ProfitByMonthOverhead, name: "Project by month, after overhead, 320", ...at320 };
export const ProfitByMonthEmpty: Story = {
  name: "Project by month, empty",
  render: () => <MonthsRoute data={{ ...periodMonths, months: [], by_currency: [] }} />,
};
