import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";
import { ProjectUtilityMonthsScreen } from "./project-utility-months-screen";
import { GEFEN, storyUtilityClient, useOfflineOnceRead, utilityMonthsSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UTILITY_MONTHS_KEY, UtilityClientProvider, type UtilityMonth } from "../utility-refunds";

const meta = {
  title: "Screens/ProjectUtilityMonths",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function GoOffline() {
  useOfflineOnceRead(UTILITY_MONTHS_KEY);
  return null;
}

/** The page at its route, reading through a stand-in for Flow's server. */
function MonthsStory({ query = "", months = utilityMonthsSample(), offline = false }: { query?: string; months?: UtilityMonth[]; offline?: boolean }) {
  return (
    <StoryRoute entry={`/projects/${GEFEN}/utilities/months${query}`} tabs>
      <UtilityClientProvider client={storyUtilityClient(undefined, undefined, months)}>
        {offline ? <GoOffline /> : null}
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

/** Large amounts and long names: each month and its sheet's lines wrap only between whole parts. */
const longMonths = () => utilityMonthsSample().map((month) => ({
  ...month,
  rent_in: month.rent_in * 1000n + 7n,
  bills_paid: month.bills_paid * 1000n + 3n,
  not_refunded: month.not_refunded === 0n ? 0n : month.not_refunded * 1000n + 3n,
  rent_lines: month.rent_lines.map((line) => ({
    ...line,
    amount_minor: line.amount_minor * 1000n + 7n,
    parts: line.parts.map((part) => ({ ...part, category_name: `${String(part.category_name)} לבניין`, amount_minor: part.amount_minor * 1000n + 7n })),
  })),
  bills: month.bills.map((bill) => ({ ...bill, category_name: `${String(bill.category_name)} ושירותים משותפים`, amount_minor: bill.amount_minor * 1000n + 3n })),
}));

/** FLOW-1153: at 320 a label keeps its amount ("חשבונות $304,863.00") and no line starts with "·". */
export const ProjectUtilityMonthsLong: Story = {
  name: "ProjectUtilityMonths, long content",
  render: () => <MonthsStory months={longMonths()} />,
};

/** FLOW-1153: in the sheet a bill's date and state stay together, and a split rent line breaks only between parts. */
export const ProjectUtilityMonthsLongSheet: Story = {
  name: "ProjectUtilityMonths, long content, a month's sheet",
  render: () => <MonthsStory months={longMonths()} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^אוקטובר 2026/ }));
    await expect(await within(document.body).findByText(/· הוחזר$/)).toBeInTheDocument();
  },
};

/** FLOW-1154: offline, the months stay with the moment they are from. */
export const ProjectUtilityMonthsOffline: Story = {
  name: "ProjectUtilityMonths, offline",
  render: () => <MonthsStory offline />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  },
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
