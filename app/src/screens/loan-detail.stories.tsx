import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { Route, Routes } from "react-router-dom";
import { oneLoanStore, sampleLoanStore } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { LoanDetailScreen } from "./loan-detail-screen";
import type { MemoryLoanStore } from "./loan-detail-store";

/** FLOW-106 B / FLOW-110. The loan page on invented loans; the day is pinned to 2026-10-09. */
const TODAY = "2026-10-09";

/** FLOW-139c: `path` opens the all-payments page ("payments"). */
function Page({ loanId, store, viewer = false, path = "" }: { loanId: string; store: () => MemoryLoanStore; viewer?: boolean; path?: string }) {
  const memory = store();
  return (
    <StoryRoute entry={`/loans/${loanId}${path === "" ? "" : `/${path}`}`} viewer={viewer}>
      <Routes>
        <Route path="/loans/:loanId" element={<LoanDetailScreen store={memory} today={TODAY} />} />
        <Route path="/loans/:loanId/payments" element={<LoanDetailScreen store={memory} today={TODAY} view="payments" />} />
      </Routes>
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Loan page",
  component: Page,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

const at320 = { parameters: { flowRouter: false, viewport: { defaultViewport: "flow320" } } };

function loan(id: string, options: Parameters<typeof oneLoanStore>[1] = {}, path = "") {
  return { args: { loanId: id, store: () => oneLoanStore(id, options), path } };
}

export const Amortizing: Story = { name: "Amortizing", ...loan("loan-mortgage") };
export const AmortizingAt320: Story = { name: "Amortizing, 320", ...loan("loan-mortgage"), ...at320 };
export const InterestOnlyRates: Story = { name: "Interest-only with rate changes", ...loan("loan-bridge") };
export const InterestOnlyAt320: Story = {
  name: "Interest-only with rate changes, 320",
  ...loan("loan-bridge"),
  ...at320,
  // The סוג value stays whole at 320: its row is a button with the kind's words and no clipped line.
  play: async ({ canvasElement }) => {
    const kind = within(canvasElement).getByRole("button", { name: /^סוג/ });
    await expect(kind).toHaveTextContent("ריבית בלבד");
    await expect(kind.scrollWidth - kind.clientWidth).toBeLessThanOrEqual(1);
  },
};
export const BalloonWaitingReview: Story = { name: "Balloon, a payment waiting for review", ...loan("loan-note") };
export const Demand: Story = { name: "Demand", ...loan("loan-partner") };
/** FLOW-138 "Hide" (FLOW-356): נפרעה and its date lead; no balance and no next payment. */
export const PaidOffWithBalance: Story = { name: "Paid off with a balance left", ...loan("loan-old") };
export const Viewer: Story = { name: "Viewer", args: { loanId: "loan-bridge", store: () => oneLoanStore("loan-bridge"), viewer: true } };
export const Loading: Story = { name: "Loading", ...loan("loan-mortgage", { phase: "loading" }) };
export const LoadError: Story = { name: "Error", ...loan("loan-mortgage", { phase: "error" }) };
export const NotFound: Story = { name: "Not found", args: { loanId: "no-such-loan", store: () => sampleLoanStore() } };

/** FLOW-139c: every payment, by year, newest first. */
export const Payments: Story = { name: "All payments", ...loan("loan-mortgage", {}, "payments") };
export const PaymentsAt320: Story = { name: "All payments, 320", ...loan("loan-mortgage", {}, "payments"), ...at320 };
export const PaymentsInterestOnly: Story = { name: "All payments, interest-only", ...loan("loan-bridge", {}, "payments") };

function bodyOf(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

export const StatusSheet: Story = {
  name: "Status sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סטטוס/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "מצב" })).toBeInTheDocument();
  },
};

export const CloseDateFloor: Story = {
  name: "Close date from the last payment",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סטטוס/ }));
    const status = await bodyOf(canvasElement).findByRole("dialog", { name: "מצב" });
    await userEvent.click(within(status).getByRole("radio", { name: "נפרעה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "תאריך פירעון" })).toBeInTheDocument();
  },
};

export const KindSheet: Story = {
  name: "Kind sheet",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סוג/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "סוג ההלוואה" })).toBeInTheDocument();
  },
};

export const KindSheetDemand: Story = {
  name: "Kind sheet, demand loan",
  ...loan("loan-partner"),
  play: KindSheet.play,
};

export const PartSheet: Story = {
  name: "Fees category sheet",
  ...loan("loan-note"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^עמלות/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "עמלות" })).toBeInTheDocument();
  },
};

export const RateSheet: Story = {
  name: "Rate sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    // The sample loans have no rate change (the board's), so the sheet opens from the terms card's ריבית row.
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^ריבית 10\.5%/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "קביעת ריבית" })).toBeInTheDocument();
  },
};

export const DeleteConfirm: Story = {
  name: "Delete confirm",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מחיקת ההלוואה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "למחוק את ההלוואה?" })).toBeInTheDocument();
  },
};

/** FLOW-139c: the page's cards in order, and the next payment's figure. */
export const CardsInOrder: Story = {
  name: "Cards in order",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByText("יתרה היום")).toBeInTheDocument();
    await expect(page.getByText(/^התשלום הבא · /)).toBeInTheDocument();
    await expect(page.getByText("שולם השנה")).toBeInTheDocument();
    await expect(page.getByText("3 התשלומים האחרונים")).toBeInTheDocument();
  },
};
