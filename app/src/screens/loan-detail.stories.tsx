import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { Route, Routes } from "react-router-dom";
import { oneLoanStore, sampleLoanStore } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { LoanDetailScreen } from "./loan-detail-screen";
import type { MemoryLoanStore } from "./loan-detail-store";

/** FLOW-106 B / FLOW-110. The loan page on invented loans; the day is pinned to 2026-10-09. */
const TODAY = "2026-10-09";

function Page({ loanId, store, viewer = false }: { loanId: string; store: () => MemoryLoanStore; viewer?: boolean }) {
  return (
    <StoryRoute entry={`/settings/loans/${loanId}`} viewer={viewer}>
      <Routes>
        <Route path="/settings/loans/:loanId" element={<LoanDetailScreen store={store()} today={TODAY} />} />
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

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { flowRouter: false, viewport: { defaultViewport: "flow320" } } };
const se = { parameters: { flowRouter: false, viewport: { defaultViewport: "flow375-se" } } };

function loan(id: string, options: Parameters<typeof oneLoanStore>[1] = {}) {
  return { args: { loanId: id, store: () => oneLoanStore(id, options) } };
}

export const Amortizing: Story = { name: "Amortizing", ...loan("loan-mortgage") };
export const AmortizingDark: Story = { name: "Amortizing, dark", ...loan("loan-mortgage"), ...dark };
export const AmortizingSE: Story = { name: "Amortizing, 375×667", ...loan("loan-mortgage"), ...se };
export const InterestOnlyRates: Story = { name: "Interest-only with rate changes", ...loan("loan-bridge") };
export const InterestOnlyRatesDark: Story = { name: "Interest-only with rate changes, dark", ...loan("loan-bridge"), ...dark };
export const InterestOnlyRates320: Story = { name: "Interest-only with rate changes, 320", ...loan("loan-bridge"), ...at320 };
export const BalloonWaitingReview: Story = { name: "Balloon, a payment waiting for review", ...loan("loan-note") };
export const BalloonWaitingReviewDark320: Story = { name: "Balloon, waiting for review, dark 320", ...loan("loan-note"), ...dark, ...at320 };
export const Demand: Story = { name: "Demand", ...loan("loan-partner") };
export const DemandDark: Story = { name: "Demand, dark", ...loan("loan-partner"), ...dark };
export const PaidOffWithBalance: Story = { name: "Paid off with a balance left", ...loan("loan-old") };
export const PaidOffWithBalanceDark320: Story = { name: "Paid off with a balance left, dark 320", ...loan("loan-old"), ...dark, ...at320 };
export const Viewer: Story = { name: "Viewer", args: { loanId: "loan-bridge", store: () => oneLoanStore("loan-bridge"), viewer: true } };
export const ViewerDark: Story = { ...Viewer, name: "Viewer, dark", ...dark };
export const Loading: Story = { name: "Loading", ...loan("loan-mortgage", { phase: "loading" }) };
export const LoadingDark: Story = { name: "Loading, dark", ...loan("loan-mortgage", { phase: "loading" }), ...dark };
export const LoadError: Story = { name: "Error", ...loan("loan-mortgage", { phase: "error" }) };
export const LoadError320: Story = { name: "Error, 320", ...loan("loan-mortgage", { phase: "error" }), ...at320 };
export const NotFound: Story = { name: "Not found", args: { loanId: "no-such-loan", store: () => sampleLoanStore() } };
export const NotFoundDark: Story = { ...NotFound, name: "Not found, dark", ...dark };

function bodyOf(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

export const StatusSheet: Story = {
  name: "Status sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^מצב/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "מצב" })).toBeInTheDocument();
  },
};
export const StatusSheetDark320: Story = { ...StatusSheet, name: "Status sheet, dark 320", ...dark, ...at320 };

export const CloseDateFloor: Story = {
  name: "Close date from the last payment",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^מצב/ }));
    const status = await bodyOf(canvasElement).findByRole("dialog", { name: "מצב" });
    await userEvent.click(within(status).getByRole("radio", { name: "נפרעה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "תאריך פירעון" })).toBeInTheDocument();
  },
};
export const CloseDateFloorDark: Story = { ...CloseDateFloor, name: "Close date from the last payment, dark", ...dark };

export const KindSheet: Story = {
  name: "Kind sheet",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סוג/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "סוג ההלוואה" })).toBeInTheDocument();
  },
};
export const KindSheetDark320: Story = { ...KindSheet, name: "Kind sheet, dark 320", ...dark, ...at320 };

export const KindSheetDemand: Story = {
  name: "Kind sheet, demand loan",
  ...loan("loan-partner"),
  play: KindSheet.play,
};

export const PartSheet: Story = {
  name: "Fees category sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^עמלות/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "עמלות" })).toBeInTheDocument();
  },
};
export const PartSheetDark: Story = { ...PartSheet, name: "Fees category sheet, dark", ...dark };

export const RateSheet: Story = {
  name: "Rate change sheet",
  ...loan("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^שינוי ריבית מ־01\/09\/2026/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "שינוי ריבית" })).toBeInTheDocument();
  },
};
export const RateSheet320: Story = { ...RateSheet, name: "Rate change sheet, 320", ...at320 };

export const DeleteConfirm: Story = {
  name: "Delete confirm",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מחיקת ההלוואה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "למחוק את ההלוואה?" })).toBeInTheDocument();
  },
};
export const DeleteConfirmDark: Story = { ...DeleteConfirm, name: "Delete confirm, dark", ...dark };
