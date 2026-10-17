import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { sampleLoanStore } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar, pagesBusiness, storyBody } from "../ui/screen-stories-support";
import { LoansScreen, type LoansSample } from "./loans-screen";

/** The הלוואות tab (FLOW-139b). Open loans, then the closed group, collapsed. Invented loans. */
const ROWS = sampleLoanStore().rows();

const pagesLoans = [
  { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "p1", projectName: "וילה אלון" },
  { id: "l2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "p2", projectName: "פרויקט גפן" },
];

/** Stories pass the loans as a fixed sample; the tab reads nothing else. */
function Tab({ sample, closedOpen = false, viewer = false }: { sample: LoansSample; closedOpen?: boolean; viewer?: boolean }) {
  const screen = <LoansScreen sample={sample} closedOpen={closedOpen} />;
  return (
    <StoryRoute entry="/loans" tabs>
      <ExampleBar />
      {viewer ? <ViewerPreview>{screen}</ViewerPreview> : screen}
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Loans",
  parameters: { flowRouter: false },
  component: Tab,
  args: { sample: { ...pagesBusiness, loans: pagesLoans } },
} satisfies Meta<typeof Tab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  name: "Loans",
  args: { sample: { ...pagesBusiness, loans: ROWS } },
};

/** FLOW-138: a paid-off loan shows only how and when it ended; the closed group is open. */
export const ListClosedShown: Story = {
  name: "Loans, closed shown",
  args: { sample: { ...pagesBusiness, loans: ROWS }, closedOpen: true },
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    const paid = await body.findByRole("button", { name: /נפרעה/ });
    await expect(paid.getAttribute("aria-label")).not.toMatch(/\$/);
    await expect(paid.querySelector(".ui-loans-amount")).toBeNull();
    const closed = within(canvasElement).getByRole("button", { name: /נסגרה/ });
    await expect(closed.querySelector(".ui-loans-amount")).toBeNull();
  },
};

/** The closed group opens and shuts with its toggle. */
export const ListClosedToggle: Story = {
  name: "Loans, closed toggle",
  args: { sample: { ...pagesBusiness, loans: ROWS } },
  play: async ({ canvasElement }) => {
    const toggle = await storyBody(canvasElement).findByRole("button", { name: /נסגרו · / });
    await expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    await expect(toggle.getAttribute("aria-expanded")).toBe("true");
  },
};

export const Empty: Story = {
  name: "Loans, empty",
  args: { sample: { ...pagesBusiness, loans: [] } },
};

/** Every loan closed: the group says הלוואות שנסגרו under the empty state. */
export const OnlyClosed: Story = {
  name: "Loans, only closed",
  args: { sample: { ...pagesBusiness, loans: ROWS.filter((row) => row.status != null && row.status !== "open") } },
};

export const Loading: Story = {
  name: "Loans, loading",
  args: { sample: { ...pagesBusiness, loans: "loading" } },
};

export const LoadError: Story = {
  name: "Loans, error",
  args: { sample: { ...pagesBusiness, loans: "error" } },
};

export const Viewer: Story = {
  name: "Loans, viewer",
  args: { sample: { ...pagesBusiness, loans: pagesLoans }, viewer: true },
};

export const EmptyViewer: Story = {
  name: "Loans, empty, viewer",
  args: { sample: { ...pagesBusiness, loans: [] }, viewer: true },
};
