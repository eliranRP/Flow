import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Route, Routes } from "react-router-dom";
import { sampleLoanStore, sampleLoans } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { LoansSummaryScreen } from "./loans-summary-screen";
import { memoryLoanStore, type MemoryLoanStore } from "./loan-detail-store";

/** The loans summary (the board's Loans · summary) on the invented loans; the day is pinned to 2026-10-17. */
const TODAY = "2026-10-17";

function Page({ store, phase, viewer = false }: { store: () => MemoryLoanStore; phase?: "loading" | "error"; viewer?: boolean }) {
  const memory = store();
  return (
    <StoryRoute entry="/loans/summary" viewer={viewer}>
      <Routes>
        <Route path="/loans/summary" element={<LoansSummaryScreen store={memory} currency="USD" today={TODAY} phase={phase} />} />
      </Routes>
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Loans/Summary",
  component: Page,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Since the loans started: the debt at the start and what is left, what was paid by part, and each open loan; the closed loans under them. */
export const AllTime: Story = {
  name: "Since the start",
  args: { store: () => sampleLoanStore() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "סיכום הלוואות" })).toBeInTheDocument();
    await expect(canvas.getByRole("radio", { name: "מתחילת ההלוואות" })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByText("החוב בהתחלה")).toBeInTheDocument();
  },
};

/** This year: the debt on 1 January, what was paid since, and each loan's share of it. */
export const ThisYear: Story = {
  name: "This year",
  args: { store: () => sampleLoanStore() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "2026" }));
    await expect(canvas.getByText("החוב ב־01/01/2026")).toBeInTheDocument();
    await expect(canvas.getByText("שולם ב־2026")).toBeInTheDocument();
  },
};

/** Only loans that ended: nothing open to sum, so the empty state leads back to the list. */
export const NoOpenLoans: Story = {
  name: "No open loans",
  args: { store: () => memoryLoanStore(sampleLoans().filter((sample) => sample.loan.status !== "open")) },
};

export const Viewer: Story = { name: "Viewer", args: { store: () => sampleLoanStore(), viewer: true } };
export const Loading: Story = { name: "Loading", args: { store: () => sampleLoanStore(), phase: "loading" } };
export const LoadError: Story = { name: "Error", args: { store: () => sampleLoanStore(), phase: "error" } };
