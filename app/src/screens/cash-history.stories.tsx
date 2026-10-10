import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { sampleCashYearMonths, sampleCashYears } from "../dev/cash-sample";
import { at320, dark } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { CashHistorySkeleton, CashHistoryScreen, CashYearScreen } from "./cash-history";

/** FLOW-416 (owner's "Years, then months"): the cash history and a year's page. Invented figures. */

const meta = {
  title: "Screens/Cash history",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Years: Story = {
  name: "History, years",
  render: () => (
    <StoryRoute entry="/cash/history" tabs>
      <CashHistoryScreen sample={sampleCashYears()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^תזרים מאז מרץ \d{4}$/)).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "שנים" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("link", { name: /^תזרים \d{4} / })).toHaveLength(4);
  },
};
export const YearsDark: Story = { ...Years, name: "History, years, dark", ...dark };
export const Years320: Story = { ...Years, name: "History, years, 320", ...at320 };

export const YearsTwoCurrencies: Story = {
  name: "History, years, a second currency",
  render: () => (
    <StoryRoute entry="/cash/history" tabs>
      <CashHistoryScreen sample={sampleCashYears(new Date(), "two")} />
    </StoryRoute>
  ),
};

function yearSample() {
  const months = sampleCashYearMonths();
  return { months, years: sampleCashYears(), year: Number(months.months[0]?.month.slice(0, 4)) };
}

export const Year: Story = {
  name: "A past year",
  render: () => {
    const { months, years, year } = yearSample();
    return (
      <StoryRoute entry={`/cash/year/${String(year)}`} tabs>
        <CashYearScreen sample={{ months, years }} year={year} />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "חודשים" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("link", { name: /^תזרים \S+ \d{4} / })).toHaveLength(12);
  },
};
export const YearDark: Story = { ...Year, name: "A past year, dark", ...dark };
export const Year320: Story = { ...Year, name: "A past year, 320", ...at320 };

export const Loading: Story = {
  name: "History, loading",
  render: () => (
    <StoryRoute entry="/cash/history" tabs>
      <CashHistorySkeleton back="/" section="שנים" />
    </StoryRoute>
  ),
};
