import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { Route, Routes } from "react-router-dom";
import { oneLoanStore, sampleLoanStore } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { LoanDetailScreen } from "./loan-detail-screen";
import type { MemoryLoanStore } from "./loan-detail-store";

/** FLOW-106 B / FLOW-110. The loan page on invented loans; the day is pinned to 2026-10-09. */
const TODAY = "2026-10-09";

/** FLOW-434: `path` opens a sub-page ("details", "future", "future/2027", "future/end"). */
function Page({ loanId, store, viewer = false, path = "" }: { loanId: string; store: () => MemoryLoanStore; viewer?: boolean; path?: string }) {
  const memory = store();
  return (
    <StoryRoute entry={`/settings/loans/${loanId}${path === "" ? "" : `/${path}`}`} viewer={viewer}>
      <Routes>
        <Route path="/settings/loans/:loanId" element={<LoanDetailScreen store={memory} today={TODAY} />} />
        <Route path="/settings/loans/:loanId/details" element={<LoanDetailScreen store={memory} today={TODAY} view="details" />} />
        <Route path="/settings/loans/:loanId/future" element={<LoanDetailScreen store={memory} today={TODAY} view="future" />} />
        <Route path="/settings/loans/:loanId/future/:period" element={<LoanDetailScreen store={memory} today={TODAY} view="period" />} />
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
const se = { parameters: { flowRouter: false, viewport: { defaultViewport: "flow375-se" } } };

function loan(id: string, options: Parameters<typeof oneLoanStore>[1] = {}, path = "") {
  return { args: { loanId: id, store: () => oneLoanStore(id, options), path } };
}

function details(id: string) {
  return loan(id, {}, "details");
}

export const AmortizingSE: Story = { name: "Amortizing, 375×667", ...loan("loan-mortgage"), ...se };
export const InterestOnlyRates: Story = { name: "Interest-only with rate changes", ...loan("loan-bridge") };
export const InterestOnlyRatesDetails: Story = {
  name: "Interest-only with rate changes, 320",
  ...details("loan-bridge"),
  ...at320,
  // The סוג value wraps to a second line at 320 instead of ending in "חו…" (design lead).
  play: async ({ canvasElement }) => {
    const kind = within(canvasElement).getByRole("button", { name: /^סוג/ });
    const value = kind.querySelector<HTMLElement>(".ui-row-title");
    await expect(value).toHaveTextContent("ריבית בלבד · 12 מתוך 24 חודשים");
    await expect(value == null ? Number.NaN : value.scrollHeight - value.clientHeight).toBeLessThanOrEqual(1);
    await expect(value == null ? "" : getComputedStyle(value).whiteSpace).toBe("normal");
  },
};
export const BalloonWaitingReview: Story = { name: "Balloon, a payment waiting for review", ...loan("loan-note") };
export const Demand: Story = { name: "Demand", ...loan("loan-partner") };
/** FLOW-138 "Hide" (FLOW-356): נפרעה and its date lead; no balance, no תשלום חודשי and no מצב row. */
export const PaidOffWithBalanceSE: Story = { name: "Paid off with a balance left, 375×667", ...loan("loan-old"), ...se };
export const Viewer: Story = { name: "Viewer", args: { loanId: "loan-bridge", store: () => oneLoanStore("loan-bridge"), viewer: true } };
export const Loading: Story = { name: "Loading", ...loan("loan-mortgage", { phase: "loading" }) };
export const LoadError: Story = { name: "Error", ...loan("loan-mortgage", { phase: "error" }) };
export const NotFound: Story = { name: "Not found", args: { loanId: "no-such-loan", store: () => sampleLoanStore() } };

function bodyOf(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

export const StatusSheet: Story = {
  name: "Status sheet",
  ...details("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^מצב/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "מצב" })).toBeInTheDocument();
  },
};

export const CloseDateFloor: Story = {
  name: "Close date from the last payment",
  ...details("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^מצב/ }));
    const status = await bodyOf(canvasElement).findByRole("dialog", { name: "מצב" });
    await userEvent.click(within(status).getByRole("radio", { name: "נפרעה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "תאריך פירעון" })).toBeInTheDocument();
  },
};

export const KindSheet: Story = {
  name: "Kind sheet",
  ...details("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^סוג/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "סוג ההלוואה" })).toBeInTheDocument();
  },
};

export const KindSheetDemand: Story = {
  name: "Kind sheet, demand loan",
  ...details("loan-partner"),
  play: KindSheet.play,
};

export const PartSheet: Story = {
  name: "Fees category sheet",
  ...details("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^עמלות/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "עמלות" })).toBeInTheDocument();
  },
};

export const RateSheet: Story = {
  name: "Rate change sheet",
  ...details("loan-bridge"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /^שינוי ריבית מ־01\/09\/2026/ }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "שינוי ריבית" })).toBeInTheDocument();
  },
};

export const DeleteConfirm: Story = {
  name: "Delete confirm",
  ...details("loan-mortgage"),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מחיקת ההלוואה" }));
    await expect(await bodyOf(canvasElement).findByRole("dialog", { name: "למחוק את ההלוואה?" })).toBeInTheDocument();
  },
};

/** FLOW-434 (owner's pick A): the sub-pages. */
export const Details: Story = { name: "Loan details page", ...details("loan-mortgage") };
export const Future: Story = { name: "Future payments", ...loan("loan-mortgage", {}, "future") };
export const FutureInterestOnly: Story = { name: "Future payments, interest-only", ...loan("loan-bridge", {}, "future") };
export const FutureYear: Story = { name: "One year ahead", ...loan("loan-mortgage", {}, "future/2027") };
export const FutureToEnd: Story = { name: "To the end of the loan", ...loan("loan-mortgage", {}, "future/end") };
export const FutureDemand: Story = { name: "Future payments, demand loan", ...loan("loan-partner", {}, "future") };

/** The part rows add up to the "שולם השנה" total and their shares to 100%. */
export const PaidThisYearAddsUp: Story = {
  name: "Paid this year adds up, shares in one column",
  ...loan("loan-mortgage"),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByText(/^תשלום הבא · /)).toBeInTheDocument();
    const pcts = [...canvasElement.querySelectorAll(".ui-share-pct")];
    await expect(pcts.length).toBeGreaterThan(1);
    await expect(pcts.map((node) => Number(node.textContent.replace("%", ""))).reduce((sum, value) => sum + value, 0)).toBe(100);
    // The shares stand in one column whatever each amount's length (owner, 2026-10-10).
    const edges = new Set(pcts.map((node) => Math.round(node.getBoundingClientRect().left)));
    await expect(edges.size).toBe(1);
  },
};
