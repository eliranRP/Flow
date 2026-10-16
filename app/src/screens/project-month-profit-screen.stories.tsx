import type { Meta, StoryObj } from "@storybook/react";
import { JUNIPER_MONTH_PROFIT } from "../dev/profit-month-sample";
import { ProjectMonthProfitScreen } from "./project-month-profit-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function MonthRoute({ entry, name }: { entry: string; name?: string }) {
  const sample = name == null ? JUNIPER_MONTH_PROFIT : { ...JUNIPER_MONTH_PROFIT, project: { ...JUNIPER_MONTH_PROFIT.project, name } };
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ProjectMonthProfitScreen sample={sample} />
    </StoryRoute>
  );
}

/** Opened from a month row of the project's profit page: Back names the project's profit. */
export const ProjectMonthProfit: Story = {
  name: "Project, one month opened from by month",
  render: () => <MonthRoute entry="/projects/juniper-ct/profit/2026-10" />,
};

/** A long project name is cut with an ellipsis on the Back label and the subline. */
export const ProjectMonthLongName: Story = {
  name: "Project, one month, long project name",
  render: () => <MonthRoute entry="/projects/juniper-ct/profit/2026-10" name="שיפוץ דירת גן ברחוב הדוגמה הארוך 128" />,
};

/** Grouped by category: each category closed until tapped. */
export const ProjectMonthByCategory: Story = {
  name: "Project, one month, by category",
  render: () => <MonthRoute entry="/projects/juniper-ct/profit/2026-10?order=category" />,
};
