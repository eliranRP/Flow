// vitest-css: these queries rely on the app's CSS hiding elements.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { oneLoanStore, sampleLoanStore } from "../dev/loan-detail-sample";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ViewerPreview } from "../use-is-viewer";
import { LoanDetailScreen } from "./loan-detail-screen";
import type { MemoryLoanStore } from "./loan-detail-store";

// FLOW-106 B. The loan page on a memory store: the project sheet (moved here from the list,
// FLOW-119), refusals, and the viewer's static rows.

// FLOW-434: the rows these tests open moved to the פרטי הלוואה page, so it is the default entry.
function renderLoan(store: MemoryLoanStore, loanId: string, wrap: (ui: ReactNode) => ReactNode = (ui) => ui, path = "details") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BooksProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/settings/loans/${loanId}${path === "" ? "" : `/${path}`}`]}>
            <Routes>
              <Route path="/settings/loans/:loanId" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" />)} />
              <Route path="/settings/loans/:loanId/details" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" view="details" />)} />
              <Route path="/settings/loans/:loanId/future" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" view="future" />)} />
              <Route path="/settings/loans/:loanId/future/:period" element={wrap(<LoanDetailScreen store={store} today="2026-10-09" view="period" />)} />
              <Route path="/settings/loans" element={<p>רשימת ההלוואות</p>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </BooksProvider>
    </QueryClientProvider>,
  );
}

function toast(text: string | RegExp) {
  return screen.getAllByRole("status", { hidden: true }).find((node) => (typeof text === "string" ? node.textContent.includes(text) : text.test(node.textContent)));
}

describe("loan page: project (FLOW-119 on the loan page)", () => {
  it("moves the loan to another project, then ביטול puts it back", async () => {
    const store = sampleLoanStore();
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    expect(screen.getByRole("radio", { name: /^שיפוץ דוגמה 12/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(toast("ההלוואה שויכה לפרויקט")).toBeDefined(); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(screen.getByRole("button", { name: /^פרויקט בית דוגמה 9/ })).toBeInTheDocument();
    const undo = within(toast("ההלוואה שויכה לפרויקט") as HTMLElement).getByRole("button", { name: "ביטול", hidden: true });
    fireEvent.click(undo);
    await waitFor(() => { expect(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ })).toBeInTheDocument(); });
  });

  it("clears the project with ללא פרויקט", async () => {
    const store = sampleLoanStore();
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: "ללא פרויקט" }));
    await waitFor(() => { expect(toast("ההלוואה הוסרה מהפרויקט")).toBeDefined(); });
    expect(store.read("loan-mortgage")).toMatchObject({ phase: "ready", bundle: { loan: { projectId: null } } });
  });

  it("closes without a write on the checked row", async () => {
    const store = sampleLoanStore();
    const update = vi.spyOn(store, "update");
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^שיפוץ דוגמה 12/ }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the sheet and names a permission refusal", async () => {
    const store = sampleLoanStore({ refuse: { update: "forbidden" } });
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(toast("אין הרשאה לעדכן הלוואה.")).toBeDefined(); });
    expect(screen.getByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^שיפוץ דוגמה 12/ })).toHaveAttribute("aria-checked", "true");
  });

  it("says the project is gone when its foreign key fails (23503)", async () => {
    const store = sampleLoanStore();
    vi.spyOn(store, "update").mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "23503" }));
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(toast("הפרויקט לא נמצא.")).toBeDefined(); });
    expect(screen.getByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
  });

  it("waits for the save: other rows are disabled and Escape does not close", async () => {
    const store = sampleLoanStore();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const real = store.update;
    vi.spyOn(store, "update").mockImplementation(async (id, patch) => { await hold; await real(id, patch); });
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^פרויקט שיפוץ דוגמה 12/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^בית דוגמה 9/ }));
    await waitFor(() => { expect(screen.getByRole("radio", { name: "ללא פרויקט" })).toHaveAttribute("aria-disabled", "true"); });
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
    expect(screen.getByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument(); });
  });
});

describe("loan page: states and the viewer", () => {
  it("shows a viewer static rows with no sheets and no delete", () => {
    renderLoan(sampleLoanStore(), "loan-bridge", (ui) => <ViewerPreview>{ui}</ViewerPreview>);
    expect(screen.getByRole("heading", { name: "פרטי הלוואה" })).toBeInTheDocument();
    expect(screen.getByText("בית דוגמה 9")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^פרויקט/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^מצב/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מחיקת ההלוואה" })).not.toBeInTheDocument();
  });

  it("leads a paid-off loan with נפרעה and its date only, and changes its status from there (FLOW-138, FLOW-356)", async () => {
    renderLoan(sampleLoanStore(), "loan-old", undefined, "");
    expect(screen.getByText(/^נפרעה · \d\d\/\d\d\/\d{4}$/)).toBeInTheDocument();
    expect(screen.queryByText("יתרה")).not.toBeInTheDocument();
    expect(screen.queryByText("תשלום חודשי")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^מצב/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שינוי מצב" }));
    await waitFor(() => { expect(screen.getByRole("radio", { name: "נפרעה" })).toHaveAttribute("aria-checked", "true"); });
    // Reopening brings the balance back; the מצב row lives on the פרטי הלוואה page (FLOW-434).
    fireEvent.click(screen.getByRole("radio", { name: "פתוחה" }));
    await waitFor(() => { expect(screen.getByText("יתרה")).toBeInTheDocument(); });
  });

  it("offers the tint ניסיון חוזר on a failed read, not the filled one (FLOW-334)", () => {
    renderLoan(oneLoanStore("loan-mortgage", { phase: "error" }), "loan-mortgage");
    const retry = screen.getByRole("button", { name: "ניסיון חוזר" });
    expect(retry).toHaveClass("ui-btn-pill");
    expect(retry).not.toHaveClass("ui-btn-retry");
  });

  it("shows not found with a way back to the list", () => {
    renderLoan(sampleLoanStore(), "no-such-loan");
    expect(screen.getByText("ההלוואה לא נמצאה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "לרשימת ההלוואות" }));
    expect(screen.getByText("רשימת ההלוואות")).toBeInTheDocument();
  });

  it("keeps a close date before the last payment inside the date sheet", async () => {
    const store = sampleLoanStore();
    vi.spyOn(store, "update").mockRejectedValueOnce(new Error("loan_payments_after_close"));
    renderLoan(store, "loan-bridge");
    fireEvent.click(screen.getByRole("button", { name: /^מצב/ }));
    fireEvent.click(screen.getByRole("radio", { name: "נפרעה" }));
    const dateSheet = screen.getByRole("dialog", { name: "תאריך פירעון" });
    expect(dateSheet).toHaveTextContent("התשלום האחרון שויך ב־01/10/2026. אי אפשר לבחור יום לפניו.");
    fireEvent.click(within(dateSheet).getByRole("button", { name: "החלה" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "תאריך פירעון" })).toHaveTextContent("יש תשלום משויך אחרי התאריך הזה. בחרו תאריך מאוחר יותר.");
    });
  });

  it("shows payment amounts without a minus (DESIGN-RULES §3.7)", () => {
    renderLoan(sampleLoanStore(), "loan-mortgage");
    const row = screen.getByRole("link", { name: /^תשלום 01\/09\/2026/ });
    expect(row).toHaveAccessibleName("תשלום 01/09/2026, $1,512.40");
    expect(row.textContent).not.toMatch(/[-−]/);
  });

  it("checks the default row when the loan names the keyed category itself", async () => {
    const store = sampleLoanStore();
    await store.update("loan-mortgage", { categoryIds: { interest: "cat-interest" } });
    renderLoan(store, "loan-mortgage");
    fireEvent.click(screen.getByRole("button", { name: /^ריבית ריבית$/ }));
    expect(screen.getByRole("radio", { name: "ברירת מחדל · ריבית" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("loan page: what it leads with (FLOW-434)", () => {
  it("leads an amortizing loan with the next payment and opens the years ahead", async () => {
    renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "");
    expect(screen.getByText(/^תשלום הבא · /)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "שולם השנה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^תשלומים הבאים/ }));
    expect(await screen.findByRole("heading", { name: "לפי שנה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^2027,/ }));
    expect(await screen.findByText("לתשלום בשנה")).toBeInTheDocument();
    expect(screen.getByText("12 תשלומים")).toBeInTheDocument();
  });

  it("opens the part's category sheet from its שולם השנה row", async () => {
    renderLoan(sampleLoanStore(), "loan-mortgage", undefined, "");
    fireEvent.click(screen.getByRole("button", { name: /^ריבית,/ }));
    expect(await screen.findByRole("dialog", { name: "ריבית" })).toBeInTheDocument();
  });

  it("has no next payment for a demand loan, and the future page says why", () => {
    renderLoan(sampleLoanStore(), "loan-partner", undefined, "future");
    expect(screen.getByText("אין לוח תשלומים להלוואה הזו")).toBeInTheDocument();
  });
});

