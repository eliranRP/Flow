// vitest-css: these queries rely on the app's CSS hiding elements.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleLoanStore, SAMPLE_INTEREST_ONLY } from "../dev/loan-detail-sample";
import { mapleCourtClosingPaidReturns } from "../dev/returns-sample";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { closingPaidDraft, closingPaidPlaceholder, closingPaidRefusal, closingPaidValue, showsClosingPaid } from "./loan-closing-paid-sheet";
import { LOAN_DETAIL_COLUMNS, readLoanRow, type LoanDetailDbRow } from "./loan-detail-data";
import { LoanDetailScreen } from "./loan-detail-screen";
import { liveLoanWrites, useLiveLoan, type MemoryLoanStore } from "./loan-detail-store";
import { toReturnsJson } from "./project-returns-test-support";

// FLOW-466 (decision 0250): what a project's loan paid at closing, on the loan page. The owner sets
// it through set_loan_closing_paid; empty is the whole loan; a viewer reads it.

const rpc = vi.fn();
const from = vi.fn();
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc, from }) }));

afterEach(() => { rpc.mockReset(); from.mockReset(); });

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

  it("keeps the sheet on Back while a save is in flight, though an overlapping save ended first (FLOW-1164)", async () => {
    const store = sampleLoanStore();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    // The first save fails in a way that can be retried; the second is held; the retry then passes.
    const write = vi.spyOn(store, "setClosingPaid")
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockImplementationOnce(async () => { await hold; return { prior: null }; });
    window.history.replaceState(null, "", "/loans/loan-bridge");
    const view = renderWithProviders(
      <BrowserRouter>
        <Routes>
          <Route path="/loans/:loanId" element={<LoanDetailScreen store={store} today="2026-10-09" />} />
        </Routes>
      </BrowserRouter>,
      { memoryRouter: false },
    );
    fireEvent.click(closingRow());
    const sheet = () => screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(sheet()).getByLabelText("סכום"), { target: { value: "180000" } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(toast("ניסיון חוזר")).toBeDefined(); });
    fireEvent.change(within(sheet()).getByLabelText("סכום"), { target: { value: "170000" } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(write).toHaveBeenCalledTimes(2); });
    fireEvent.click(within(toast("ניסיון חוזר") as HTMLElement).getByRole("button", { name: "ניסיון חוזר", hidden: true }));
    await waitFor(() => { expect(write).toHaveBeenCalledTimes(3); });
    await waitFor(() => { expect(toast("סכום ששולם בסגירה · $180,000")).toBeDefined(); });
    window.history.back();
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
    expect(sheet()).toBeInTheDocument();
    await act(async () => { release(); await Promise.resolve(); });
    view.unmount();
  });

  it("a ✕ tapped during a save that then fails still closes the sheet on the next ✕ (FLOW-1164)", async () => {
    // The Back test above leaves its history traversal in flight; let it land before this sheet opens.
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 100); }); });
    const store = sampleLoanStore();
    let fail: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { fail = resolve; });
    vi.spyOn(store, "setClosingPaid").mockImplementationOnce(async () => {
      await hold;
      throw new Error("Failed to fetch");
    });
    renderLoan(store, "loan-bridge");
    fireEvent.click(closingRow());
    const sheet = () => screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(sheet()).getByLabelText("סכום"), { target: { value: "180000" } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "שמירה" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "סגירה" }));
    await act(async () => { fail(); await Promise.resolve(); });
    await waitFor(() => { expect(toast("ניסיון חוזר")).toBeDefined(); });
    expect(sheet()).toBeInTheDocument();
    fireEvent.click(within(sheet()).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "סכום ששולם בסגירה" })).not.toBeInTheDocument(); });
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
    expect(field).toHaveAttribute("aria-describedby", within(dialog).getByText("הסכום צריך להיות בין 0 ל־$210,000.").id);
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

  // FLOW-473 (decision 0253): the owner's pick, the row only for a loan paid out at closing (Sub2).
  it("shows no row for a project's loan that was not paid out at closing", () => {
    renderLoan(sampleLoanStore(), "loan-mortgage");
    expect(screen.getByRole("button", { name: /^פרויקט/ })).toBeInTheDocument();
    expect(screen.queryByText("סכום ששולם בסגירה")).not.toBeInTheDocument();
  });

  it("keeps the row while such a loan has an amount stored, so it can be cleared", async () => {
    const store = sampleLoanStore();
    await store.setClosingPaid("loan-mortgage", 4_000_000n);
    renderLoan(store, "loan-mortgage");
    expect(closingRow()).toHaveTextContent("$40,000");
    fireEvent.click(closingRow());
    const dialog = screen.getByRole("dialog", { name: "סכום ששולם בסגירה" });
    fireEvent.change(within(dialog).getByLabelText("סכום"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(closingOf(store, "loan-mortgage")).toBeNull(); });
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^סכום ששולם בסגירה/ })).not.toBeInTheDocument(); });
  });

  it("decides the row from the project, the closing and the stored amount", () => {
    expect(showsClosingPaid({ projectId: "p", closingPaidMinor: null }, true)).toBe(true);
    expect(showsClosingPaid({ projectId: "p", closingPaidMinor: null }, false)).toBe(false);
    expect(showsClosingPaid({ projectId: "p", closingPaidMinor: 0n }, false)).toBe(true);
    expect(showsClosingPaid({ projectId: null, closingPaidMinor: 1n }, true)).toBe(false);
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

describe("the live loan read: paid out at closing (FLOW-473)", () => {
  /** A chain that ends in `result` whatever is called on it (select, eq, order, maybeSingle). */
  function chain(result: unknown): unknown {
    const node: Record<string, unknown> = {};
    for (const key of ["select", "eq", "order", "maybeSingle"]) node[key] = () => node;
    node.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return node;
  }

  function readLive(takenOver: readonly string[]) {
    const returns = {
      ...mapleCourtClosingPaidReturns,
      inputs: { ...mapleCourtClosingPaidReturns.inputs, takenOverLoans: mapleCourtClosingPaidReturns.inputs.takenOverLoans.map((loan, index) => ({ ...loan, id: takenOver[index] ?? loan.id })) },
    };
    from.mockImplementation((table: string) => chain(
      table === "loans" ? { data: toDbRow(), error: null }
        : table === "loan_balances" ? { data: { balance_minor: 21_000_000, flagged_parts: 0 }, error: null }
          : { data: [], error: null },
    ));
    rpc.mockImplementation((name: string) => Promise.resolve(name === "get_property_returns" ? { data: toReturnsJson(returns), error: null } : { data: [], error: null }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(() => useLiveLoan("loan-bridge", true), {
      wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>,
    });
  }

  it("reads the loan as paid out at closing when its project's returns name it", async () => {
    const { result } = readLive(["loan-bridge"]);
    await waitFor(() => { expect(result.current.phase === "ready" && result.current.bundle.paidAtClosing).toBe(true); });
    expect(rpc).toHaveBeenCalledWith("get_property_returns", { p_project_id: "proj-b" });
  });

  it("reads it as not paid out at closing when they name other loans", async () => {
    const { result } = readLive(["loan-other", "loan-another"]);
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("get_property_returns", { p_project_id: "proj-b" }); });
    await waitFor(() => { expect(result.current.phase).toBe("ready"); });
    expect(result.current.phase === "ready" && result.current.bundle.paidAtClosing).toBe(false);
  });
});
