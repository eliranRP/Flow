import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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

/**
 * Stories pick the loans by name, never as args: the loans carry bigint amounts, and Storybook sends
 * args across the manager channel with JSON.stringify (story-args.test.ts).
 */
type LoansData = "pages" | "rows" | "empty" | "loading" | "error";

function Tab({ data, closedOpen = false, viewer = false }: { data: LoansData; closedOpen?: boolean; viewer?: boolean }) {
  const loans: LoansSample["loans"] = data === "pages" ? pagesLoans : data === "rows" ? ROWS : data === "empty" ? [] : data;
  const screen = <LoansScreen sample={{ ...pagesBusiness, loans }} closedOpen={closedOpen} />;
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
  args: { data: "pages" },
} satisfies Meta<typeof Tab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  name: "Loans",
  args: { data: "rows" },
};

/** FLOW-138: a paid-off loan shows only how and when it ended; the closed group is open. */
export const ListClosedShown: Story = {
  name: "Loans, closed shown",
  args: { data: "rows", closedOpen: true },
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    const paid = await body.findByRole("button", { name: /נפרעה/ });
    // A paid-off loan still owing a balance shows it, as the list does for every loan.
    await expect(paid.getAttribute("aria-label")).toMatch(/\$1,240/);
    await expect(paid.querySelector(".ui-loans-amount")).not.toBeNull();
    const closed = within(canvasElement).getByRole("button", { name: /נסגרה/ });
    await expect(closed.querySelector(".ui-loans-amount")?.textContent).toMatch(/\$0/);
  },
};

/** The closed group opens and shuts with its toggle. */
export const ListClosedToggle: Story = {
  name: "Loans, closed toggle",
  args: { data: "rows" },
  play: async ({ canvasElement }) => {
    const toggle = await storyBody(canvasElement).findByRole("button", { name: /נסגרו · / });
    await expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    await expect(toggle.getAttribute("aria-expanded")).toBe("true");
  },
};

export const Empty: Story = {
  name: "Loans, empty",
  args: { data: "empty" },
};

export const Loading: Story = {
  name: "Loans, loading",
  args: { data: "loading" },
};

export const LoadError: Story = {
  name: "Loans, error",
  args: { data: "error" },
};

export const Viewer: Story = {
  name: "Loans, viewer",
  args: { data: "pages", viewer: true },
};
