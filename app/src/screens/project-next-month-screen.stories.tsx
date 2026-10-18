import type { Meta, StoryObj } from "@storybook/react";
import { JUNIPER_NEXT, JUNIPER_NEXT_EDITED } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import { ProjectNextMonthScreen } from "./project-next-month-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ProfitNext frame: next month's forecast, opened from the dashed card on the project's profit page. */
export const ProjectNextMonth: Story = {
  name: "Project, next month forecast",
  render: () => (
    <StoryRoute entry="/projects/juniper-ct/profit/next" tabs>
      <ExampleBar />
      <ProjectNextMonthScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT }} />
    </StoryRoute>
  ),
};

/** ProfitNextEdited: a changed row (שינית · היה), an added line, and a removed row under the rows with החזרה. */
export const ProjectNextMonthEdited: Story = {
  name: "Project, next month forecast, edited",
  render: () => (
    <StoryRoute entry="/projects/juniper-ct/profit/next" tabs>
      <ExampleBar />
      <ProjectNextMonthScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT_EDITED }} />
    </StoryRoute>
  ),
};
