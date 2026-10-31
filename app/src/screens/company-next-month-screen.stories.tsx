import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_PROJECTS, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { CompanyNextMonthScreen } from "./company-next-month-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-1000 (board CompanyNextA): the company's צפי for next month, by project, the general costs last. */
export const CompanyNextMonth: Story = {
  name: "Company, next month forecast by project",
  render: () => (
    <StoryRoute entry="/forecast/next" tabs>
      <ExampleBar />
      <CompanyNextMonthScreen sample={HOME_NEXT_MONTH_SAMPLE.next} today={NEXT_MONTH_TODAY} projects={NEXT_MONTH_PROJECTS.projects} currency="USD" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("תזרים צפוי")).toBeInTheDocument();
    await expect(canvas.getByText("כללי")).toBeInTheDocument();
  },
};
