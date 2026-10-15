import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { sampleLoanStore } from "../dev/loan-detail-sample";
import { LoanGroupedList, type LoanListRow } from "./loan-list";

/** FLOW-106 §3.1. Open loans, then paid-off and closed ones under "נסגרו (N)". Invented loans. */
const ROWS: LoanListRow[] = sampleLoanStore().rows();
const ONLY_CLOSED: LoanListRow[] = ROWS.filter((row) => row.status != null && row.status !== "open");

/** Args stay plain JSON: Storybook cannot serialise bigint balances, so stories pick the rows by name. */
type ListArgs = Omit<ComponentProps<typeof LoanGroupedList>, "rows"> & { rowSet?: "all" | "onlyClosed" };

function List({ rowSet = "all", ...props }: ListArgs) {
  return <LoanGroupedList rows={rowSet === "onlyClosed" ? ONLY_CLOSED : ROWS} {...props} />;
}

const meta = {
  title: "Screens/Loans list",
  component: List,
  args: { rowSet: "all", onOpen: () => undefined },
} satisfies Meta<typeof List>;

export default meta;
type Story = StoryObj<typeof meta>;


export const Grouped: Story = {};
export const ClosedOpen: Story = { args: { closedOpen: true } };
/** FLOW-138: a paid-off loan, and a closed one with nothing owed, show only how and when it ended. */
export const ClosedOpenPaid: Story = {
  args: { closedOpen: true },
  play: async ({ canvasElement }) => {
    const paid = within(canvasElement).getByRole("button", { name: /נפרעה/ });
    await expect(paid.getAttribute("aria-label")).not.toMatch(/\$/);
    await expect(paid.querySelector(".ui-loan-amount")).toBeNull();
    const closed = within(canvasElement).getByRole("button", { name: /נסגרה/ });
    await expect(closed.querySelector(".ui-loan-amount")).toBeNull();
  },
};
/** Every loan closed: the group says הלוואות שנסגרו under the empty state. */
export const OnlyClosed: Story = { args: { rowSet: "onlyClosed" } };
/** Without onOpen the rows are static (a viewer still opens the loan page, read-only). */
export const StaticRows: Story = { args: { onOpen: undefined, closedOpen: true } };
