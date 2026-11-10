import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";
import { ProjectUtilityIncomeScreen } from "./project-utility-income-screen";
import { GEFEN, storyUtilityClient, useOfflineOnceRead, utilityIncomeSample, utilityTypesSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UTILITY_INCOME_KEY, UtilityClientProvider, type UtilityIncome } from "../utility-refunds";

const meta = {
  title: "Screens/ProjectUtilityIncome",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function GoOffline() {
  useOfflineOnceRead(UTILITY_INCOME_KEY);
  return null;
}

/** The page at its route, reading through a stand-in for Flow's server. */
function IncomeStory({ query = "", income = utilityIncomeSample(), offline = false }: { query?: string; income?: UtilityIncome; offline?: boolean }) {
  return (
    <StoryRoute entry={`/projects/${GEFEN}/utilities/bills/t-power-10/income${query}`} tabs>
      <UtilityClientProvider client={storyUtilityClient(utilityTypesSample(), undefined, income)}>
        {offline ? <GoOffline /> : null}
        <ExampleBar />
        <Routes>
          <Route path="/projects/:projectId/utilities/bills/:billId/income" element={<ProjectUtilityIncomeScreen />} />
        </Routes>
      </UtilityClientProvider>
    </StoryRoute>
  );
}

/** FLOW-1159 (V3-J-Income): the checked bill pinned, two months each way, the dashed line where the bill is. */
export const ProjectUtilityIncome: Story = {
  render: () => <IncomeStory />,
};

/** A wider window: the segment moves and the server is asked for 3 months. */
export const ProjectUtilityIncomeWider: Story = {
  name: "ProjectUtilityIncome, 3 months",
  render: () => <IncomeStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("radio", { name: "3 חודשים" }));
    await expect(await within(canvasElement).findByText("3 חודשים לפני ואחרי")).toBeInTheDocument();
  },
};

/** A bill that came back: its status names the payment's date, and that payment is among the lines. */
export const ProjectUtilityIncomeRefunded: Story = {
  name: "ProjectUtilityIncome, a refunded bill",
  render: () => {
    const income = utilityIncomeSample();
    return <IncomeStory income={{ ...income, bill: { ...income.bill, state: "refunded", payment_transaction_id: "pay-rent-10" } }} />;
  },
};

/** No payment came in around the bill: the page says so, and the marker stays. */
export const ProjectUtilityIncomeNone: Story = {
  name: "ProjectUtilityIncome, no payments",
  render: () => <IncomeStory income={{ ...utilityIncomeSample(), lines: [] }} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("לא נכנס תשלום מהשוכר בטווח הזה")).toBeInTheDocument();
  },
};

/** Long names, many parts and large amounts: every line wraps and none is cut. */
export const ProjectUtilityIncomeLong: Story = {
  name: "ProjectUtilityIncome, long content",
  render: () => {
    const income = utilityIncomeSample();
    return (
      <IncomeStory
        income={{
          ...income,
          bill: { ...income.bill, supplier_name: "City Light לשירותי אנרגיה של העירייה", amount_minor: income.bill.amount_minor * 1000n + 7n },
          lines: income.lines.map((line) => ({
            ...line,
            party: line.party == null ? null : `${line.party} בע״מ לניהול נכסים והשכרה`,
            amount_minor: line.amount_minor * 1000n + 7n,
            parts: line.parts.map((part) => ({ ...part, category_name: `${String(part.category_name)} ושירותים משותפים`, amount_minor: part.amount_minor * 1000n + 7n })),
          })),
        }}
      />
    );
  },
};

/** Offline, the payments stay with the moment they are from. */
export const ProjectUtilityIncomeOffline: Story = {
  name: "ProjectUtilityIncome, offline",
  render: () => <IncomeStory offline />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  },
};

export const ProjectUtilityIncomeLoading: Story = {
  name: "ProjectUtilityIncome, loading",
  render: () => <IncomeStory query="?preview=loading" />,
};

export const ProjectUtilityIncomeError: Story = {
  name: "ProjectUtilityIncome, failed",
  render: () => <IncomeStory query="?preview=error" />,
};
