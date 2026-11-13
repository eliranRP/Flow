import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";
import { ProjectUtilityBillsScreen } from "./project-utility-bills-screen";
import { GEFEN, storyUtilityClient, useOfflineOnceRead, utilityTypesSample } from "./utility-refunds-sample";
import { expectNoOrphanDots } from "../ui/hint-parts.stories-support";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UTILITY_REFUNDS_KEY, UtilityClientProvider, type UtilityBill } from "../utility-refunds";

const meta = {
  title: "Screens/ProjectUtilityBills",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function GoOffline() {
  useOfflineOnceRead(UTILITY_REFUNDS_KEY);
  return null;
}

/** The page at its route, reading through a stand-in for Flow's server. */
function BillsStory({ query = "", bills = utilityTypesSample(), offline = false, viewer = false }: { query?: string; bills?: UtilityBill[]; offline?: boolean; viewer?: boolean }) {
  return (
    <StoryRoute entry={`/projects/${GEFEN}/utilities/bills${query}`} tabs viewer={viewer}>
      <UtilityClientProvider client={storyUtilityClient(bills)}>
        {offline ? <GoOffline /> : null}
        <ExampleBar />
        <Routes>
          <Route path="/projects/:projectId/utilities/bills" element={<ProjectUtilityBillsScreen />} />
        </Routes>
      </UtilityClientProvider>
    </StoryRoute>
  );
}

/** FLOW-1159 (V3-J-B3-ByType): what the tenant owes, then the bills by type: water all back, power and sewer missing some. */
export const ProjectUtilityBills: Story = {
  render: () => <BillsStory />,
  // FLOW-1169 (V3-J-B3-ByType): מי משלם ends the page, a link to the payers page.
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("link", { name: /^מי משלם/ })).toHaveAttribute("href", `/projects/${GEFEN}/utilities`);
  },
};

/** A bill not refunded opens its drawer: its status, the type's pattern and history, the income around it, the answers. */
export const ProjectUtilityBillsDrawer: Story = {
  name: "ProjectUtilityBills, a bill's drawer",
  render: () => <BillsStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /City Light.*06\/10\/26/ }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(await within(dialog).findByText(/החשבון הזה כבר מעבר לזה/)).toBeInTheDocument();
    await expect(within(dialog).getByRole("link", { name: /מה נכנס סביב החשבון הזה/ })).toBeInTheDocument();
  },
};

/** A refunded bill's drawer has no answers: its context and its transaction. */
export const ProjectUtilityBillsDrawerRefunded: Story = {
  name: "ProjectUtilityBills, a refunded bill's drawer",
  render: () => <BillsStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /City Water.*04\/11\/26/ }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(await within(dialog).findByText(/בדרך כלל מים מוחזר/)).toBeInTheDocument();
  },
};

/** Nothing owed: "הכול הוחזר" under the title and in every head. */
export const ProjectUtilityBillsAllBack: Story = {
  name: "ProjectUtilityBills, all refunded",
  render: () => <BillsStory bills={utilityTypesSample().filter((bill) => bill.state === "refunded" || bill.state === "seen")} />,
};

/**
 * Long names and large amounts: the supplier, the row's title, wraps; its line, the date first, breaks only between
 * whole parts, with no "·" at either end of a line (FLOW-1175).
 */
export const ProjectUtilityBillsLong: Story = {
  name: "ProjectUtilityBills, long content",
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <BillsStory
      bills={utilityTypesSample().map((bill) => ({
        ...bill,
        supplier_name: `${String(bill.supplier_name)} לשירותי אנרגיה ומים של העירייה`,
        category_name: `${String(bill.category_name)} ושירותים משותפים לבניין`,
        amount_minor: bill.amount_minor * 1000n + 7n,
      }))}
    />
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("link", { name: /^מי משלם/ });
    await expectNoOrphanDots(canvasElement.querySelector(".ui-urf-screen") as Element);
  },
};

/** A viewer's rows open the bill's transaction, with no drawer. */
export const ProjectUtilityBillsViewer: Story = {
  name: "ProjectUtilityBills, viewer",
  render: () => <BillsStory viewer />,
};

/** Offline, the bills stay with the moment they are from. */
export const ProjectUtilityBillsOffline: Story = {
  name: "ProjectUtilityBills, offline",
  render: () => <BillsStory offline />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  },
};

export const ProjectUtilityBillsEmpty: Story = {
  name: "ProjectUtilityBills, none yet",
  render: () => <BillsStory bills={[]} />,
};

export const ProjectUtilityBillsLoading: Story = {
  name: "ProjectUtilityBills, loading",
  render: () => <BillsStory query="?preview=loading" />,
};

export const ProjectUtilityBillsError: Story = {
  name: "ProjectUtilityBills, failed",
  render: () => <BillsStory query="?preview=error" />,
};
