// vitest-css: these queries rely on the app's CSS hiding elements.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleLoanStore, SAMPLE_INTEREST_ONLY } from "../dev/loan-detail-sample";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { closingPaidDraft, closingPaidPlaceholder, closingPaidRefusal, closingPaidValue } from "./loan-closing-paid-sheet";
import { LOAN_DETAIL_COLUMNS, readLoanRow, type LoanDetailDbRow } from "./loan-detail-data";
import { LoanDetailScreen } from "./loan-detail-screen";
import { liveLoanWrites, type MemoryLoanStore } from "./loan-detail-store";

// FLOW-466 (decision 0250): what a project's loan paid at closing, on the loan page. The owner sets
// it through set_loan_closing_paid; empty is the whole loan; a viewer reads it.

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

afterEach(() => { rpc.mockReset(); });

function renderLoan(store: MemoryLoanStore, loanId: string, wrap: (ui: ReactNode) => ReactNode = (ui) => ui) {
  return renderWithProviders(
    <Routes>
      <Route path="/loans/:loanId" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" />)} />
    </Routes>,
    { route: `/loans/${loanId}` },
  );
}

function toast(text: string) {
  return screen.getAllByRole("status", { hidden: true }).find((node) => node.textContent.includes(text));
}

const closingRow = () => screen.getByRole("button", { name: /^סכום ששולם בסגירה/ });

function closingOf(store: MemoryLoanStore, loanId: string): bigint | null | undefined {
  const read = store.read(loanId);
  return read.phase === "ready" ? read.bundle.loan.closingPaidMinor : undefined;
}

describe("loan page: the amount paid at closing (FLOW-466)", () => {
  it("reads the whole loan by default, saves an amount, and ביטול puts the whole loan back", async () => {
    const store = sampleLoanStore();
    renderLoan(store, "loan-bridge");
    expect(closingRow()).toHaveTextContent("כל ההלוואה · $210,000");
    fireEvent.click(closingRow());
    const dialog = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    expect(within(dialog).getByText("מהטופס של הסגירה. ריק = כל ההלוואה")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("סכום")).toHaveAttribute("placeholder", "210,000");
    fireEvent.change(within(dialog).getByLabelText("סכום"), { target: { value: "180000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(toast("סכום ששולם בסגירה · $180,000")).toBeDefined(); });
    expect(closingOf(store, "loan-bridge")).toBe(18_000_000n);
    await waitFor(() => { expect(closingRow()).toHaveTextContent("$180,000"); });
    fireEvent.click(within(toast("סכום ששולם בסגירה · $180,000") as HTMLElement).getByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => { expect(closingOf(store, "loan-bridge")).toBeNull(); });
  });

  it("saves an empty field as the whole loan (null)", async () => {
    const store = sampleLoanStore();
    await store.setClosingPaid("loan-bridge", 15_000_000n);
    renderLoan(store, "loan-bridge");
    fireEvent.click(closingRow());
    const dialog = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(dialog).getByLabelText("סכום"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(toast("סכום ששולם בסגירה · כל ההלוואה")).toBeDefined(); });
    expect(closingOf(store, "loan-bridge")).toBeNull();
  });

  it("keeps an amount above the loan in the sheet, with no write", () => {
    const store = sampleLoanStore();
    const write = vi.spyOn(store, "setClosingPaid");
    renderLoan(store, "loan-bridge");
    fireEvent.click(closingRow());
    const dialog = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(dialog).getByLabelText("סכום"), { target: { value: "250000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(within(dialog).getByText("הסכום צריך להיות בין 0 ל־$210,000.")).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it("says a wrong amount when the field is left, and clears it as the amount is fixed (FLOW-472)", () => {
    renderLoan(sampleLoanStore(), "loan-bridge");
    fireEvent.click(closingRow());
    const dialog = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    const field = within(dialog).getByLabelText("סכום");
    fireEvent.change(field, { target: { value: "250000" } });
    expect(within(dialog).queryByText("הסכום צריך להיות בין 0 ל־$210,000.")).not.toBeInTheDocument();
    fireEvent.blur(field);
    expect(within(dialog).getByText("הסכום צריך להיות בין 0 ל־$210,000.")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(field, { target: { value: "200000" } });
    fireEvent.blur(field);
    expect(within(dialog).queryByText("הסכום צריך להיות בין 0 ל־$210,000.")).not.toBeInTheDocument();
  });

  it("shows the server's validation refusal in the sheet, and a missing loan in a toast", async () => {
    const refused = sampleLoanStore({ refuse: { setClosingPaid: "validation" } });
    const first = renderLoan(refused, "loan-bridge");
    fireEvent.click(closingRow());
    const dialog = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(dialog).getByLabelText("סכום"), { target: { value: "1000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await within(dialog).findByText("הסכום צריך להיות בין 0 ל־$210,000.")).toBeInTheDocument();
    first.unmount();

    const gone = sampleLoanStore({ refuse: { setClosingPaid: "loan not found" } });
    renderLoan(gone, "loan-bridge");
    fireEvent.click(closingRow());
    const again = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(again).getByLabelText("סכום"), { target: { value: "1000" } });
    fireEvent.click(within(again).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(toast("ההלוואה לא נמצאה.")).toBeDefined(); });
  });

  it("shows no row for a loan with no project", () => {
    renderLoan(sampleLoanStore(), "loan-partner");
    expect(screen.queryByText("סכום ששולם בסגירה")).not.toBeInTheDocument();
  });

  it("reads static for a viewer", () => {
    renderLoan(sampleLoanStore(), "loan-bridge", (ui) => <ViewerPreview>{ui}</ViewerPreview>);
    expect(screen.getByText("סכום ששולם בסגירה")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^סכום ששולם בסגירה/ })).not.toBeInTheDocument();
  });
});

describe("closing paid: the field, the read and the RPC", () => {
  const loan = { principalMinor: 21_000_000n, closingPaidMinor: null, currency: "USD" as const };

  it("parses empty as null and keeps the amount within the principal", () => {
    expect(closingPaidDraft("  ", loan)).toEqual({ ok: true, minor: null });
    expect(closingPaidDraft("180,000.50", loan)).toEqual({ ok: true, minor: 18_000_050n });
    expect(closingPaidDraft("0", loan)).toEqual({ ok: true, minor: 0n });
    expect(closingPaidDraft("210000.01", loan)).toEqual({ ok: false, message: "הסכום צריך להיות בין 0 ל־$210,000." });
    expect(closingPaidValue({ ...loan, closingPaidMinor: 4_000_000n })).toBe("$40,000");
    expect(closingPaidPlaceholder(loan)).toBe("210,000");
    expect(closingPaidPlaceholder({ ...loan, principalMinor: 12_345_650n, currency: "ILS" })).toBe("123,456.50");
    expect(closingPaidRefusal(Object.assign(new Error("validation"), { code: "22023" }), loan)).toBe("הסכום צריך להיות בין 0 ל־$210,000.");
    expect(closingPaidRefusal(new Error("loan not found"), loan)).toBeNull();
  });

  it("reads closing_paid_minor with the loan", () => {
    expect(LOAN_DETAIL_COLUMNS).toContain("closing_paid_minor");
    const row = { ...toDbRow(), closing_paid_minor: 4_000_000 };
    expect(readLoanRow(row, null).closingPaidMinor).toBe(4_000_000n);
    expect(readLoanRow({ ...row, closing_paid_minor: null }, null).closingPaidMinor).toBeNull();
  });

  it("saves through set_loan_closing_paid, null for the whole loan, and keeps the error's code", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "loan-1", closing_paid_minor: 4_000_000, prior: null }, error: null });
    await expect(liveLoanWrites.setClosingPaid("loan-1", 4_000_000n)).resolves.toEqual({ prior: null });
    expect(rpc).toHaveBeenLastCalledWith("set_loan_closing_paid", { p_loan_id: "loan-1", p_closing_paid_minor: 4_000_000 });
    rpc.mockResolvedValueOnce({ data: { id: "loan-1", closing_paid_minor: null, prior: 4_000_000 }, error: null });
    await expect(liveLoanWrites.setClosingPaid("loan-1", null)).resolves.toEqual({ prior: 4_000_000n });
    expect(rpc).toHaveBeenLastCalledWith("set_loan_closing_paid", { p_loan_id: "loan-1", p_closing_paid_minor: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "validation", code: "22023" } });
    await expect(liveLoanWrites.setClosingPaid("loan-1", 1n)).rejects.toMatchObject({ message: "validation", code: "22023" });
  });
});

function toDbRow(): LoanDetailDbRow {
  const l = SAMPLE_INTEREST_ONLY;
  return {
    id: l.id,
    company_id: l.companyId,
    name: l.name,
    currency: l.currency,
    principal_minor: Number(l.principalMinor),
    annual_rate_ppm: l.annualRatePpm,
    term_months: l.termMonths,
    start_date: l.startDate,
    payment_minor: l.paymentMinor == null ? null : Number(l.paymentMinor),
    escrow_minor: Number(l.escrowMinor),
    kind: l.kind,
    interest_only_months: l.interestOnlyMonths,
    amortization_months: l.amortizationMonths,
    status: l.status,
    closed_on: l.closedOn,
    project_id: l.projectId,
    interest_category_id: null,
    escrow_category_id: null,
    principal_category_id: null,
    fees_category_id: null,
  };
}
