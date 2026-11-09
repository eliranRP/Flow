import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";
import { ProjectUtilityMonthsScreen } from "./project-utility-months-screen";
import { GEFEN, storyUtilityClient, utilityMonthsSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UtilityClientProvider, type UtilityMonth } from "../utility-refunds";

const meta = {
  title: "Screens/ProjectUtilityMonths",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page at its route, reading through a stand-in for Flow's server. */
function MonthsStory({ query = "", months = utilityMonthsSample() }: { query?: string; months?: UtilityMonth[] }) {
  return (
    <StoryRoute entry={`/projects/${GEFEN}/utilities/months${query}`} tabs>
      <UtilityClientProvider client={storyUtilityClient(undefined, undefined, months)}>
        <ExampleBar />
        <Routes>
          <Route path="/projects/:projectId/utilities/months" element={<ProjectUtilityMonthsScreen />} />
        </Routes>
      </UtilityClientProvider>
    </StoryRoute>
  );
}

/** FLOW-1144 (V3-Project-UtilityMonths): four months: all back, Gas Co missing, all back, and one with no rent. */
export const ProjectUtilityMonths: Story = {
  render: () => <MonthsStory />,
};

/** A month opens its sheet: the rent that came in and the bills paid, each line opening its transaction. */
export const ProjectUtilityMonthsSheet: Story = {
  name: "ProjectUtilityMonths, a month's sheet",
  render: () => <MonthsStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^אוקטובר 2026/ }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(await within(dialog).findByText("חסר $80.36")).toBeInTheDocument();
  },
};

/** A month with no rent: its sheet says no payment came in. */
export const ProjectUtilityMonthsNoRent: Story = {
  name: "ProjectUtilityMonths, a month with no rent",
  render: () => <MonthsStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^יולי 2026/ }));
    await expect(await within(document.body).findByText("לא נכנס תשלום החודש")).toBeInTheDocument();
  },
};

/** Large amounts and long names wrap at 320 and are never cut. */
export const ProjectUtilityMonthsLong: Story = {
  name: "ProjectUtilityMonths, long content",
  render: () => (
    <MonthsStory
      months={utilityMonthsSample().map((month) => ({
        ...month,
        rent_in: month.rent_in * 1000n + 7n,
        bills_paid: month.bills_paid * 1000n + 3n,
        not_refunded: month.not_refunded === 0n ? 0n : month.not_refunded * 1000n + 3n,
      }))}
    />
  ),
};

export const ProjectUtilityMonthsEmpty: Story = {
  name: "ProjectUtilityMonths, none yet",
  render: () => <MonthsStory months={[]} />,
};

export const ProjectUtilityMonthsLoading: Story = {
  name: "ProjectUtilityMonths, loading",
  render: () => <MonthsStory query="?preview=loading" />,
};

export const ProjectUtilityMonthsError: Story = {
  name: "ProjectUtilityMonths, failed",
  render: () => <MonthsStory query="?preview=error" />,
};
