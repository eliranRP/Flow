import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { CompanyNextMonthBlock } from "./company-next-month-block";
import { NextMonthBlock } from "./next-month-block";

/**
 * FLOW-1139: the next-month blocks while their reads are out. The forecast card and the month chart each hold their
 * place as a skeleton in their own shape (the chart: a title bar over six pairs of bars), after the 300ms wait.
 */
const meta = {
  title: "Screens/Next month block",
  parameters: { viewport: { defaultViewport: "flow390" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function chartSkeleton(canvasElement: HTMLElement) {
  await waitFor(async () => {
    await expect(canvasElement.querySelectorAll(".ui-chart-skel .ui-chart-skel-month")).toHaveLength(6);
  });
}

/** A project's profit page: the card and the chart wait for the forecast and the months together. */
export const ProjectLoading: Story = {
  name: "Project next month · loading",
  render: () => (
    <div className="ui-page-pad">
      <NextMonthBlock forecast={null} loading current={null} figures={new Map()} firstMonth={null} currency="USD" kind="profit" cardHref="/projects/p1/profit/next" categories={[]} today="2026-10-11" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await chartSkeleton(canvasElement);
    await expect(canvasElement.querySelector(".ui-fc-card")).not.toBeNull();
  },
};

/** The company's profit page: the card's skeleton while the forecast loads, the chart's while its six months load. */
export const CompanyLoading: Story = {
  name: "Company next month · loading",
  render: () => (
    <div className="ui-page-pad">
      <CompanyNextMonthBlock forecast={null} loading months={null} monthsLoading current="2026-10" thisMonthExpense={0n} currency="USD" categories={[]} today="2026-10-11" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await chartSkeleton(canvasElement);
    await expect(canvasElement.querySelector(".ui-fc-card")).not.toBeNull();
  },
};
